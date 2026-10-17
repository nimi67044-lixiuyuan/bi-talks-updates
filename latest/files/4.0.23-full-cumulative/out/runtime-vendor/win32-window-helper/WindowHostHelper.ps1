param([switch]$Serve)

$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Threading;

public static class Win32SignalOverlayHost
{
    private const int GwlStyle = -16;
    private const int GwlExStyle = -20;
    private const int GwlpHwndParent = -8;
    private const long WsChild = 0x40000000L;
    private const long WsVisible = 0x10000000L;
    private const long WsPopup = unchecked((long)0x80000000L);
    private const long WsCaption = 0x00C00000L;
    private const long WsThickFrame = 0x00040000L;
    private const long WsMinimizeBox = 0x00020000L;
    private const long WsMaximizeBox = 0x00010000L;
    private const long WsSysMenu = 0x00080000L;
    private const long WsExToolWindow = 0x00000080L;
    private const long WsExAppWindow = 0x00040000L;
    private const long WsExLayered = 0x00080000L;
    private const long WsExTopmost = 0x00000008L;
    private const uint LwaAlpha = 0x00000002;
    private static readonly IntPtr HwndTop = IntPtr.Zero;
    private const int SwHide = 0;
    private const int SwShowNoActivate = 8;
    private const uint GaRootOwner = 3;
    private const uint RdwInvalidate = 0x0001;
    private const uint RdwInternalPaint = 0x0002;
    private const uint RdwErase = 0x0004;
    private const uint RdwAllChildren = 0x0080;
    private const uint RdwUpdateNow = 0x0100;
    private const uint RdwFrame = 0x0400;
    private const int DwmwaCloak = 13;
    private static readonly HashSet<long> HiddenWindows = new HashSet<long>();
    private static readonly object TrackingLock = new object();
    private static readonly Dictionary<long, TrackingState> TrackingWindows = new Dictionary<long, TrackingState>();
    private static Thread TrackingThread;

    private sealed class TrackingState
    {
        public IntPtr Primary;
        public IntPtr Owner;
        public uint ProcessId;
        public int OffsetX;
        public int OffsetY;
        public int Width;
        public int Height;
        public int LastX;
        public int LastY;
        public bool Visible;
        public bool Presented;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Point
    {
        public int X;
        public int Y;
    }

    private static bool TryOwnerClientOrigin(IntPtr owner, out Point point)
    {
        point = new Point();
        return ClientToScreen(owner, ref point);
    }

    private static void Track(IntPtr primary, IntPtr owner, int x, int y, int width, int height, bool visible)
    {
        Point origin;
        if (!TryOwnerClientOrigin(owner, out origin)) throw new InvalidOperationException("The Bi-talks client position could not be read.");
        uint processId;
        GetWindowThreadProcessId(primary, out processId);
        lock (TrackingLock)
        {
            TrackingWindows[primary.ToInt64()] = new TrackingState {
                Primary = primary,
                Owner = owner,
                ProcessId = processId,
                OffsetX = x - origin.X,
                OffsetY = y - origin.Y,
                Width = width,
                Height = height,
                LastX = x,
                LastY = y,
                Visible = visible,
                Presented = visible && IsWindowVisible(primary)
            };
            if (TrackingThread == null)
            {
                TrackingThread = new Thread(TrackingLoop) { IsBackground = true, Name = "Bi-talks Signal window tracker" };
                TrackingThread.Start();
            }
        }
    }

    private static void SetTrackedVisibility(IntPtr primary, bool visible)
    {
        lock (TrackingLock)
        {
            TrackingState state;
            if (TrackingWindows.TryGetValue(primary.ToInt64(), out state)) state.Visible = visible;
        }
    }

    private static void ParkWindow(IntPtr hwnd, int width, int height)
    {
        if (hwnd == IntPtr.Zero || !IsWindow(hwnd)) return;
        SetCloaked(hwnd, true);
        const uint parkFlags = 0x0010 | 0x0004 | 0x0200 | 0x0400;
        SetWindowPos(hwnd, HwndTop, -32000, -32000, Math.Max(80, width), Math.Max(80, height), parkFlags);
        // Preserve WS_VISIBLE so Electron keeps its application-menu row alive,
        // but cloak the surface so DWM, task switching and the desktop never
        // present an inactive managed Signal window.
        if (!IsWindowVisible(hwnd)) ShowWindow(hwnd, SwShowNoActivate);
    }

    private static void SetCloaked(IntPtr hwnd, bool cloaked)
    {
        var value = cloaked ? 1 : 0;
        DwmSetWindowAttribute(hwnd, DwmwaCloak, ref value, sizeof(int));
    }

    private static void HideOtherWindows(string allWindowsValue, IntPtr primary)
    {
        if (String.IsNullOrWhiteSpace(allWindowsValue)) return;
        foreach (var item in allWindowsValue.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries))
        {
            var hwnd = ToHwnd(item.Trim());
            if (hwnd != IntPtr.Zero && hwnd != primary) ShowWindow(hwnd, SwHide);
        }
    }

    private static void CloakProcessWindows(HashSet<uint> processIds)
    {
        if (processIds.Count == 0) return;
        EnumWindows(delegate(IntPtr hwnd, IntPtr lParam) {
            uint processId;
            GetWindowThreadProcessId(hwnd, out processId);
            if (processIds.Contains(processId)) SetCloaked(hwnd, true);
            return true;
        }, IntPtr.Zero);
    }

    private static void TrackingLoop()
    {
        const uint moveFlags = 0x0010 | 0x0004 | 0x0200 | 0x0400;
        while (true)
        {
            var visibleCount = 0;
            var hiddenProcessIds = new HashSet<uint>();
            lock (TrackingLock)
            {
                List<long> invalidWindows = null;
                foreach (var state in TrackingWindows.Values)
                {
                    if (!IsWindow(state.Owner))
                    {
                        if (invalidWindows == null) invalidWindows = new List<long>();
                        invalidWindows.Add(state.Primary.ToInt64());
                        continue;
                    }
                    // A hidden managed Signal profile must remain guarded. Signal's
                    // Chromium process can replace its top-level HWND long after the
                    // original window was parked; without this process-scoped guard,
                    // that replacement can appear by itself while Bi-talks is minimized.
                    if (!state.Visible)
                    {
                        if (state.ProcessId != 0) hiddenProcessIds.Add(state.ProcessId);
                        continue;
                    }
                    // Keep the owned Signal surface alive while Bi-talks merely
                    // loses keyboard focus. Hiding and showing Electron's native
                    // window on every foreground transition makes Signal collapse
                    // its application-menu row and move the content upward.
                    // Normal owned-window z-order already keeps it behind the
                    // foreground application; only minimize/hide it with Bi-talks.
                    if (!IsWindowVisible(state.Owner) || IsIconic(state.Owner))
                    {
                        if (state.ProcessId != 0) hiddenProcessIds.Add(state.ProcessId);
                        if (IsWindow(state.Primary)) SetCloaked(state.Primary, true);
                        state.Presented = false;
                        continue;
                    }
                    visibleCount++;
                    if (!IsWindow(state.Primary))
                    {
                        if (invalidWindows == null) invalidWindows = new List<long>();
                        invalidWindows.Add(state.Primary.ToInt64());
                        continue;
                    }
                    Point origin;
                    if (!TryOwnerClientOrigin(state.Owner, out origin)) continue;
                    var targetX = origin.X + state.OffsetX;
                    var targetY = origin.Y + state.OffsetY;
                    if (!state.Presented || !IsWindowVisible(state.Primary))
                    {
                        SetWindowPos(state.Primary, HwndTop, targetX, targetY, state.Width, state.Height, moveFlags);
                        if (!IsWindowVisible(state.Primary)) ShowWindow(state.Primary, SwShowNoActivate);
                        SetCloaked(state.Primary, false);
                        state.Presented = true;
                    }
                    else if (targetX != state.LastX || targetY != state.LastY)
                    {
                        SetWindowPos(state.Primary, HwndTop, targetX, targetY, state.Width, state.Height, moveFlags);
                    }
                    state.LastX = targetX;
                    state.LastY = targetY;
                }
                if (invalidWindows != null)
                    foreach (var hwnd in invalidWindows) TrackingWindows.Remove(hwnd);
            }
            // Enumerate once per cycle for every hidden managed Signal PID. This
            // catches replacement HWNDs without scanning or modifying any unrelated
            // Signal installation or other desktop application.
            CloakProcessWindows(hiddenProcessIds);
            Thread.Sleep(visibleCount > 0 ? 12 : 32);
        }
    }

    private static bool IsForegroundInOwnerGroup(IntPtr foreground, IntPtr primary, IntPtr owner)
    {
        // During a short Windows activation transition there may be no foreground
        // HWND. Preserve the current surface until Windows reports the new owner.
        if (foreground == IntPtr.Zero) return true;
        if (foreground == primary || foreground == owner) return true;
        var rootOwner = GetAncestor(foreground, GaRootOwner);
        return rootOwner == primary || rootOwner == owner;
    }

    public static void Place(string primaryValue, string ownerValue, string xValue, string yValue, string widthValue, string heightValue, string visibleValue, string allWindowsValue, string recoveryValue, string showOnlyValue)
    {
        var primary = ToHwnd(primaryValue);
        var owner = ToHwnd(ownerValue);
        if (primary == IntPtr.Zero || !IsWindow(primary)) throw new InvalidOperationException("The Signal window handle is no longer valid.");
        if (owner == IntPtr.Zero || !IsWindow(owner)) throw new InvalidOperationException("The Bi-talks window handle is no longer valid.");

        var x = ToInt(xValue);
        var y = ToInt(yValue);
        var width = Math.Max(80, ToInt(widthValue));
        var height = Math.Max(80, ToInt(heightValue));
        var visible = visibleValue == "1" || visibleValue.Equals("true", StringComparison.OrdinalIgnoreCase);
        var recoveryRequested = recoveryValue == "1" || recoveryValue.Equals("true", StringComparison.OrdinalIgnoreCase);
        var showOnly = showOnlyValue == "1" || showOnlyValue.Equals("true", StringComparison.OrdinalIgnoreCase);

        if (!visible)
        {
            HiddenWindows.Add(primary.ToInt64());
            Track(primary, owner, x, y, width, height, false);
            ParkWindow(primary, width, height);
            return;
        }

        if (showOnly)
        {
            HiddenWindows.Remove(primary.ToInt64());
            SetTrackedVisibility(primary, true);
            if (IsWindowVisible(owner) && !IsIconic(owner))
            {
                const uint showOnlyFlags = 0x0010 | 0x0004 | 0x0200 | 0x0400;
                SetWindowPos(primary, HwndTop, x, y, width, height, showOnlyFlags);
                if (!IsWindowVisible(primary)) ShowWindow(primary, SwShowNoActivate);
                SetCloaked(primary, false);
            }
            else SetCloaked(primary, true);
            DwmFlush();
            HideOtherWindows(allWindowsValue, primary);
            return;
        }

        // Geometry-only updates must not synchronously repaint Chromium or wait
        // for the compositor while Signal is still loading.
        if (!recoveryRequested && IsWindowVisible(owner) && !IsIconic(owner) && IsWindowVisible(primary))
        {
            lock (TrackingLock)
            {
                TrackingState tracked;
                if (TrackingWindows.TryGetValue(primary.ToInt64(), out tracked) &&
                    tracked.Owner == owner && tracked.Visible && tracked.Presented &&
                    !HiddenWindows.Contains(primary.ToInt64()))
                {
                    const uint geometryFlags = 0x0010 | 0x0004 | 0x0200 | 0x0400 | 0x4000;
                    if (!SetWindowPos(primary, HwndTop, x, y, width, height, geometryFlags))
                        throw new InvalidOperationException("Windows rejected the Signal geometry update.");
                    Track(primary, owner, x, y, width, height, true);
                    return;
                }
            }
        }

        HiddenWindows.Remove(primary.ToInt64());
        var wasHidden = !IsWindowVisible(primary);

        var currentStyle = GetLong(primary, GwlStyle);
        // Preserve WS_VISIBLE; ShowWindow owns that state. Re-applying it here
        // made every hide/show look like a structural style change and forced
        // Electron to rebuild Signal's native menu bar.
        var style = (currentStyle | WsPopup) & ~(WsChild | WsCaption | WsThickFrame | WsMinimizeBox | WsMaximizeBox | WsSysMenu);
        var currentExStyle = GetLong(primary, GwlExStyle);
        // Keep Signal as a normal composed window. A persistent WS_EX_LAYERED
        // surface forces Chromium's client-drawn application menu to be
        // recomposited whenever message translations or account visibility
        // changes, which makes that otherwise static menu visibly jump.
        var exStyle = (currentExStyle | WsExToolWindow) & ~(WsExAppWindow | WsExTopmost | WsExLayered);
        var frameChanged = style != currentStyle || exStyle != currentExStyle;
        if (style != currentStyle) SetLong(primary, GwlStyle, style);
        if (exStyle != currentExStyle) SetLong(primary, GwlExStyle, exStyle);
        SetOwner(primary, owner);
        var transitionsDisabled = 1;
        var ownerTransitionsEnabled = 1;
        DwmSetWindowAttribute(owner, 3, ref ownerTransitionsEnabled, sizeof(int));
        DwmSetWindowAttribute(primary, 3, ref transitionsDisabled, sizeof(int));

        // Visibility follows the Bi-talks window itself, not foreground focus.
        // Repeatedly hiding the managed Electron window on deactivation causes
        // Signal's native menu row to collapse and shifts its workspace upward.
        if (!IsWindowVisible(owner) || IsIconic(owner))
        {
            SetCloaked(primary, true);
            Track(primary, owner, x, y, width, height, true);
            HideOtherWindows(allWindowsValue, primary);
            return;
        }

        const uint swpNoActivate = 0x0010;
        const uint swpNoOwnerZOrder = 0x0200;
        const uint swpNoSendChanging = 0x0400;
        const uint swpFrameChanged = 0x0020;
        var flags = swpNoActivate | swpNoOwnerZOrder | swpNoSendChanging |
            (frameChanged ? swpFrameChanged : 0);
        var sizeMessage = new IntPtr(((height & 0xffff) << 16) | (width & 0xffff));
        var redrawFlags = RdwInvalidate | RdwAllChildren | RdwUpdateNow;
        if (wasHidden && !recoveryRequested)
        {
            // Prepare the hidden Chromium surface at its final geometry and
            // reveal it once. Avoiding whole-window alpha transitions keeps the
            // Signal application menu on the normal opaque composition path.
            if (!SetWindowPos(primary, HwndTop, x, y, width, height, flags))
                throw new InvalidOperationException("Windows rejected the Signal final placement.");
            RedrawWindow(primary, IntPtr.Zero, IntPtr.Zero, redrawFlags);
            UpdateWindow(primary);
            DwmFlush();
            ShowWindow(primary, SwShowNoActivate);
            SetCloaked(primary, false);
            DwmFlush();
        }
        else
        {
            if (!SetWindowPos(primary, HwndTop, x, y, width, height, flags))
                throw new InvalidOperationException("Windows rejected the Signal window placement.");
            if (wasHidden) ShowWindow(primary, SwShowNoActivate);
            SetCloaked(primary, false);
            if (recoveryRequested)
            {
                if (!SetWindowPos(primary, HwndTop, x, y, width, height, flags))
                    throw new InvalidOperationException("Windows rejected the Signal recovery resize.");
                SendMessage(primary, 0x0005, IntPtr.Zero, sizeMessage);
            }
        }
        InvalidateRect(primary, IntPtr.Zero, false);
        RedrawWindow(primary, IntPtr.Zero, IntPtr.Zero, redrawFlags);
        UpdateWindow(primary);
        Track(primary, owner, x, y, width, height, true);
        DwmFlush();
        HideOtherWindows(allWindowsValue, primary);
    }

    private static IntPtr ToHwnd(string value) { return new IntPtr(ParseLong(value)); }
    private static int ToInt(string value) { return Int32.Parse(value, CultureInfo.InvariantCulture); }
    private static long ParseLong(string value) { return Int64.Parse(value, NumberStyles.Integer, CultureInfo.InvariantCulture); }

    private static long GetLong(IntPtr hwnd, int index)
    {
        return IntPtr.Size == 8 ? GetWindowLongPtr64(hwnd, index).ToInt64() : GetWindowLong32(hwnd, index);
    }

    private static void SetOwner(IntPtr hwnd, IntPtr owner)
    {
        if (IntPtr.Size == 8) SetWindowLongPtr64(hwnd, GwlpHwndParent, owner);
        else SetWindowLong32(hwnd, GwlpHwndParent, owner.ToInt32());
    }

    private static void SetLong(IntPtr hwnd, int index, long value)
    {
        if (IntPtr.Size == 8) SetWindowLongPtr64(hwnd, index, new IntPtr(value));
        else SetWindowLong32(hwnd, index, unchecked((int)value));
    }

    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr hWnd);
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool SetLayeredWindowAttributes(IntPtr hWnd, uint colorKey, byte alpha, uint flags);
    [DllImport("user32.dll")] private static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool InvalidateRect(IntPtr hWnd, IntPtr rect, bool erase);
    [DllImport("user32.dll")] private static extern bool RedrawWindow(IntPtr hWnd, IntPtr lprcUpdate, IntPtr hrgnUpdate, uint flags);
    [DllImport("user32.dll")] private static extern bool UpdateWindow(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool ClientToScreen(IntPtr hWnd, ref Point point);
    [DllImport("dwmapi.dll")] private static extern int DwmFlush();
    [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr hWnd, int attribute, ref int value, int size);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtr")] private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtr")] private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int nIndex, IntPtr value);
    [DllImport("user32.dll", EntryPoint = "GetWindowLong")] private static extern int GetWindowLong32(IntPtr hWnd, int nIndex);
    [DllImport("user32.dll", EntryPoint = "SetWindowLong")] private static extern int SetWindowLong32(IntPtr hWnd, int nIndex, int value);
}
"@

if (-not $Serve) { exit 2 }

while (($line = [Console]::In.ReadLine()) -ne $null) {
    try {
        $parts = $line.Split([char]9)
        if ($parts.Length -lt 8 -or $parts[0] -ne 'place') { throw 'Invalid placement command.' }
        $allWindows = if ($parts.Length -gt 8) { $parts[8] } else { '' }
        $recovery = if ($parts.Length -gt 9) { $parts[9] } else { '0' }
        $showOnly = if ($parts.Length -gt 10) { $parts[10] } else { '0' }
        [Win32SignalOverlayHost]::Place($parts[1], $parts[2], $parts[3], $parts[4], $parts[5], $parts[6], $parts[7], $allWindows, $recovery, $showOnly)
        [Console]::Out.WriteLine('ok')
    } catch {
        [Console]::Out.WriteLine("error`t$($_.Exception.Message)")
    }
    [Console]::Out.Flush()
}
