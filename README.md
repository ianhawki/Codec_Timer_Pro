# Codec Timer Pro

A RoomOS macro that adds a fully-featured timer panel to Cisco collaboration devices. Supports three timer modes, on-screen overlays, audible alarms, and call-aware auto-reset — all controlled from a custom UI Extensions panel.

---

## Features

- **Three timer modes** — Countdown, Timer (count up), and To Time (count down to a wall-clock time)
- **On-screen display** — shows the running timer directly on the room screen in two selectable styles
- **Audible alarm** — optional ringtone and alert popup when the timer expires
- **Flash warning** — on-screen text blinks in the final 20 seconds
- **Call-aware** — automatically stops and resets if a call is placed or received while the timer is running
- **Timer mode cap** — Timer mode stops automatically at 75 minutes and resets after 5 minutes of inactivity
- **Controller mode** — suppress on-screen overlay and show the timer on the touch panel only

---

## Requirements

- RoomOS device (Codec Pro, Room Kit, Room Kit EQ, Desk, Board series)
- RoomOS 11 or later recommended
- Macro editor access (administrator account)

---

## Installation

1. Open the **Macro Editor** on your device (via the web interface or directly on the touch panel)
2. Create a new macro and paste in the contents of `Codec_Timer_Pro_v3.6.10.js`
3. Save and enable the macro
4. The panel will be created automatically on the device — no manual UI Extensions import required

---

## Panel Overview

The macro builds and saves its own UI Extensions panel at runtime. The panel contains:

| Row | Widgets |
|---|---|
| Timer Options | GroupButton — Countdown / Timer / To Time |
| Display Target | GroupButton — OSD / Controller |
| Countdown Duration | Spinners for minutes (1 step) and seconds (5-step) — Countdown mode only |
| Set Time to Count To | Time display + Set Time button — To Time mode only |
| Timer Info | Info text about 75-min cap — Timer mode only |
| Control | Start / Stop · Stop & Clear |
| OSD / Alarm | OSD Type button · Audible Alarm label · Audible Alarm toggle |
| Status | Live status text |

---

## Timer Modes

### Countdown
Set a duration using the minute and second spinners (seconds step in increments of 5). Press **Start / Stop** to begin. The on-screen overlay counts down. In the final 20 seconds the display flashes as a warning. When it reaches zero, an expiry message is shown for 10 seconds then automatically cleared.

### Timer
Counts up from zero. No duration to set — just press **Start / Stop**. Automatically stops at 75 minutes or when a call is placed/received. Resets automatically after 5 minutes of inactivity.

### To Time
Counts down to a specific wall-clock time. Press **Set Time** to enter a target time in 24-hour format (4 digits, e.g. `1430` for 14:30). Press **Start / Stop** to begin.

---

## On-Screen Display

Press the **OSD Type** button to choose how the timer appears on the room screen:

| Option | Method | Best for |
|---|---|---|
| Bottom of Screen | `Video.Graphics.Text.Display` | Codec Pro, Room Kit devices |
| Top Right Alert | `UserInterface.Message.Alert.Display` | Desk, Board devices |

The selection takes effect immediately and is shown in the status widget. It persists until the macro restarts.

---

## Audible Alarm

Toggle the **Audible Alarm** switch on the panel to enable an alarm when the timer expires.

When enabled and the timer reaches zero:
- The `Connection` ringtone plays on loop
- A dismissible prompt appears on screen
- Pressing **Dismiss** stops the ringtone immediately
- If not dismissed, the alarm auto-stops after 8 seconds
- Pressing **Stop & Clear** also silences the alarm

The toggle defaults to **off** on every macro start.

---

## Display Target

The **Display Target** GroupButton controls where the timer is shown:

- **OSD** — timer appears on the room screen (main display) and the touch panel status widget
- **Controller** — timer appears on the touch panel status widget only; the room screen is not used

Switching to Controller mid-timer clears the room screen immediately. Switching back to OSD restores the overlay instantly.

---

## Configuration

All tuneable values are at the top of the macro in the `CONFIG` object:

| Key | Default | Description |
|---|---|---|
| `panelLocation` | `ControlPanel` | Where the panel appears (`HomeScreen`, `ControlPanel`, etc.) |
| `panelColor` | `#00D6A2` | Panel accent colour |
| `panelIcon` | `Briefing` | Panel icon |
| `defaultMinutes` | `10` | Countdown spinner starting value (minutes) |
| `flashThresholdSecs` | `20` | Seconds remaining when warning flash begins |
| `expiredDisplaySecs` | `10` | Seconds before expiry message auto-clears |
| `timerAutoResetMins` | `5` | Timer mode inactivity timeout (minutes) |
| `timerMaxMins` | `75` | Timer mode maximum duration (minutes) |
| `alarmRingTone` | `Connection` | Ringtone played by audible alarm |
| `alarmDuration` | `8` | Seconds the alarm plays before auto-stopping |
| `alarmTitle` | `⏰ Times Up!` | Alarm prompt heading |
| `alarmText` | `Press Dismiss To Stop Alarm` | Alarm prompt body text |

---

## Debug Logging

Set `const DEBUG = true;` near the top of the macro to enable verbose console logging. Set it back to `false` for production use to reduce codec load.

---

## Version History

See [history.txt](history.txt) for the full change log.

**Current version: 3.6.10**

---

## Licence

MIT — free to use, modify, and distribute.
