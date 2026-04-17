import xapi from 'xapi';

const CURRENT_VERSION = '3.6.10';

// ============================================================
// DEBUG — set to true to enable console logging
// Set to false in production to reduce codec load
// ============================================================
const DEBUG = false;

function debug(...args) {
  if (DEBUG) console.log(...args);
}

// ============================================================
// CONFIG — adjust these to test or tune behaviour
// ============================================================
const CONFIG = {

  // --- Panel identity ---
  panelId:       'countdown_timer',
  panelName:     'Codec Timer Pro',
  panelIcon:     'Briefing',       // Briefing | Camera | Concierge | Handset | Help | Laptop | Music | Phone | Tv
  panelColor:    '#00D6A2',
  panelLocation: 'ControlPanel',   // HomeScreen | HomeScreenAndCallControls | ControlPanel

  // --- Widget IDs ---
  widgetTimerOption:   'countdown_timeroption',    // GroupButton  — Countdown / Timer / To Time
  widgetTarget:        'countdown_target',         // GroupButton  — OSD / Controller
  widgetMinutes:       'countdown_minutes',        // Spinner      — minutes (Countdown only)
  widgetSeconds:       'countdown_seconds',        // Spinner      — seconds (Countdown only)
  widgetToTimeDisplay: 'countdown_totime_display', // Text         — shows the set target time (To Time only)
  widgetSetTime:       'countdown_settime',        // Button       — opens TextInput popup (To Time only)
  widgetStartStop:     'countdown_startstop',      // Button       — start / stop
  widgetReset:         'countdown_reset',          // Button       — stop & clear
  widgetStatus:        'countdown_status',         // Text         — in-panel status
  widgetOnScreenType:  'countdown_onscreen_type',    // Button       — open alert type picker
  widgetAudibleAlarmLabel: 'countdown_audible_alarm_label', // Text — label for audible alarm toggle
  widgetAudibleAlarm:  'countdown_audible_alarm',    // Toggle       — enable / disable audible alarm

  // --- Alert Display parameters (Desk / Board devices) ---
  // Ref: https://roomos.cisco.com/xapi/Command.UserInterface.Message.Alert.Display/
  alertDuration:          0,                  // 0 = stay until explicitly cleared
  alertCountdownTitle:    'Countdown',        // heading during Countdown mode
  alertTimerTitle:        'Timer',            // heading during Timer mode
  alertToTimeTitle:       'Time Remaining',   // heading during To Time mode
  alertExpiredTitle:      'Time Up!',         // heading when countdown / to-time reaches zero

  // --- Video.Graphics display parameters (Codec Pro / Room devices) ---

  // --- Countdown behaviour ---
  defaultMinutes:      10,  // spinner start value for minutes
  defaultSecs:          0,  // spinner start value for seconds
  tickIntervalMs:    1000,  // tick rate in ms

  // --- Flash / warning zone (Countdown and To Time modes) ---
  flashThresholdSecs:  20,  // seconds remaining when blinking begins

  // --- Expiry message ---
  expiredText:        'Timer has expired!',
  expiredDisplaySecs:  10,  // seconds to leave expiry message on screen before auto-clearing

  // --- Timer mode ---
  timerAutoResetMins:   5,  // minutes of inactivity before Stop & Clear fires automatically
  timerMaxMins:        75,  // maximum timer duration before Stop & Clear fires automatically
  widgetTimerInfo:     'countdown_timerinfo',   // Text — info notice shown in Timer mode
  timerInfoText:       'Timer counts to 75 mins max, then stops. Also resets if a call is placed.',

  // --- TextInput popup (To Time) ---
  toTimeFeedbackId:        'totime_input',

  // --- On Screen Location prompt ---
  displayModeFeedbackId:   'display_mode_prompt',

  // --- Audible alarm ---
  alarmRingTone:       'Connection',
  alarmDuration:        8,              // seconds the alarm plays before auto-stopping
  alarmTitle:          '⏰ Times Up!',
  alarmText:           'Press Dismiss To Stop Alarm',
  alarmFeedbackId:     'alarm_prompt',
};

// ============================================================
// RUNTIME STATE
// ============================================================
let timerInterval      = null;
let expiredTimeout     = null;
let timerAutoReset     = null;   // auto-reset timeout used in Timer mode
let alarmTimeout       = null;   // auto-stop timeout for audible alarm
let remainingSecs      = 0;      // used by Countdown and To Time modes
let elapsedSecs        = 0;      // used by Timer mode
let isRunning          = false;
let audibleAlarmEnabled = false; // toggled by the Audible Alarm widget
let alarmActive        = false;
let minuteVal          = CONFIG.defaultMinutes;
let secondVal          = CONFIG.defaultSecs;
let displayTarget      = 'osd';        // 'osd' (default) | 'controller'
let deviceMode         = 'textline';   // 'textline' (default) | 'alert' — chosen via On Screen Location button
let timerOption        = 'countdown';  // 'countdown' | 'timer' | 'totime'
let toTimeTarget       = '';           // user-entered clock time, e.g. "14:30"

// ============================================================
// HELPERS
// ============================================================

function formatTime(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function setStatusWidget(text) {
  xapi.Command.UserInterface.Extensions.Widget.SetValue({
    WidgetId: CONFIG.widgetStatus,
    Value:    text,
  }).catch(err => console.error('Widget.SetValue error:', err));
}

function setSpinnerDisplay(widgetId, value) {
  xapi.Command.UserInterface.Extensions.Widget.SetValue({
    WidgetId: widgetId,
    Value:    String(value),
  }).catch(err => console.error('Spinner.SetValue error:', err));
}

/** Sync a GroupButton widget to a given value. */
function syncWidget(widgetId, value) {
  xapi.Command.UserInterface.Extensions.Widget.SetValue({
    WidgetId: widgetId,
    Value:    value,
  }).catch(err => console.error('GroupButton sync error:', err));
}

/** Sync both GroupButtons to current state — called on startup and panel open. */
function syncAllGroupButtons() {
  syncWidget(CONFIG.widgetTimerOption, timerOption);
  syncWidget(CONFIG.widgetTarget,      displayTarget);
}

/**
 * Restore all volatile widget values after a panel rebuild or panel open.
 * Spinners and GroupButtons are always present; ToTime display only in totime mode.
 */
function restoreWidgetValues() {
  syncAllGroupButtons();
  xapi.Command.UserInterface.Extensions.Widget.SetValue({
    WidgetId: CONFIG.widgetAudibleAlarm,
    Value:    audibleAlarmEnabled ? 'on' : 'off',
  }).catch(err => console.error('AudibleAlarm toggle restore error:', err));
  if (timerOption === 'countdown') {
    setSpinnerDisplay(CONFIG.widgetMinutes, minuteVal);
    setSpinnerDisplay(CONFIG.widgetSeconds, secondVal);
  }
  if (timerOption === 'totime' && toTimeTarget) {
    xapi.Command.UserInterface.Extensions.Widget.SetValue({
      WidgetId: CONFIG.widgetToTimeDisplay,
      Value:    toTimeTarget,
    }).catch(err => console.error('ToTime display restore error:', err));
  }
  if (timerOption === 'timer') {
    xapi.Command.UserInterface.Extensions.Widget.SetValue({
      WidgetId: CONFIG.widgetTimerInfo,
      Value:    CONFIG.timerInfoText,
    }).catch(err => console.error('TimerInfo display error:', err));
  }
}

/**
 * Show a message on screen using the correct command for this device.
 * Only fires when displayTarget is OSD — suppressed in Controller mode.
 * Alert mode uses title as the heading; TextLine mode prepends it to the text
 * so both modes display the same label.
 */
function showMessage(text, title = CONFIG.alertCountdownTitle) {
  if (displayTarget !== 'osd') return;
  if (deviceMode === 'alert') {
    xapi.Command.UserInterface.Message.Alert.Display({
      Title:    title,
      Text:     text,
      Duration: CONFIG.alertDuration,
    }).catch(err => console.error('Alert.Display error:', err));
  } else {
    xapi.Command.Video.Graphics.Text.Display({
      Target: 'LocalOutput',
      Text:   `${title}  ${text}`,
    }).catch(err => console.error('Video.Graphics.Text.Display error:', err));
  }
}

/** Clear the on-screen message — only when target is OSD. */
function clearMessage() {
  if (displayTarget !== 'osd') return;
  forceMessageClear();
}

/** Force-clear the on-screen message regardless of current target. */
function forceMessageClear() {
  if (deviceMode === 'alert') {
    xapi.Command.UserInterface.Message.Alert.Clear()
      .catch(err => console.error('Alert.Clear error:', err));
  } else {
    xapi.Command.Video.Graphics.Clear({ Target: 'LocalOutput' })
      .catch(err => console.error('Video.Graphics.Clear error:', err));
  }
}

/** Clear both message types — used on expiry so nothing is left on screen regardless of mode. */
function clearAllMessages() {
  xapi.Command.UserInterface.Message.Alert.Clear()
    .catch(() => {});
  xapi.Command.Video.Graphics.Clear({ Target: 'LocalOutput' })
    .catch(() => {});
}

function cancelExpiredTimeout() {
  if (expiredTimeout) {
    clearTimeout(expiredTimeout);
    expiredTimeout = null;
  }
}

function cancelTimerAutoReset() {
  if (timerAutoReset) {
    clearTimeout(timerAutoReset);
    timerAutoReset = null;
  }
}

/** Return the alert title appropriate for the current timerOption. */
function currentAlertTitle() {
  if (timerOption === 'timer')  return CONFIG.alertTimerTitle;
  if (timerOption === 'totime') return CONFIG.alertToTimeTitle;
  return CONFIG.alertCountdownTitle;
}

// ============================================================
// PANEL XML
// ============================================================

/**
 * Build panel XML for the current timerOption.
 * Only the rows relevant to the selected mode are included —
 * Countdown Duration is shown for 'countdown' only;
 * Set Time to Count To is shown for 'totime' only.
 */
function buildPanelXml() {
  const durationRow = timerOption === 'countdown' ? `
      <Row>
        <Name>Countdown Duration (MM:SS)</Name>
        <Widget>
          <WidgetId>${CONFIG.widgetMinutes}</WidgetId>
          <Name>Min</Name>
          <Type>Spinner</Type>
          <Options>size=2;style=plusminus</Options>
        </Widget>
        <Widget>
          <WidgetId>${CONFIG.widgetSeconds}</WidgetId>
          <Name>Sec</Name>
          <Type>Spinner</Type>
          <Options>size=2;style=plusminus</Options>
        </Widget>
      </Row>` : '';

  const timerInfoRow = timerOption === 'timer' ? `
      <Row>
        <Name>Timer Info</Name>
        <Widget>
          <WidgetId>${CONFIG.widgetTimerInfo}</WidgetId>
          <Name> </Name>
          <Type>Text</Type>
          <Options>size=4;fontSize=small;align=center</Options>
        </Widget>
      </Row>` : '';

  const toTimeRow = timerOption === 'totime' ? `
      <Row>
        <Name>Set Time to Count To</Name>
        <Widget>
          <WidgetId>${CONFIG.widgetToTimeDisplay}</WidgetId>
          <Name>Not set</Name>
          <Type>Text</Type>
          <Options>size=3;fontSize=normal;align=center</Options>
        </Widget>
        <Widget>
          <WidgetId>${CONFIG.widgetSetTime}</WidgetId>
          <Name>Set Time</Name>
          <Type>Button</Type>
          <Options>size=1</Options>
        </Widget>
      </Row>` : '';

  return `
<Extensions>
  <Panel>
    <PanelId>${CONFIG.panelId}</PanelId>
    <Origin>local</Origin>
    <Location>${CONFIG.panelLocation}</Location>
    <Icon>${CONFIG.panelIcon}</Icon>
    <Color>${CONFIG.panelColor}</Color>
    <Name>${CONFIG.panelName}</Name>
    <ActivityType>Custom</ActivityType>
    <Page>
      <Name>${CONFIG.panelName}</Name>
      <Row>
        <Name>Timer Options</Name>
        <Widget>
          <WidgetId>${CONFIG.widgetTimerOption}</WidgetId>
          <Type>GroupButton</Type>
          <Options>size=4</Options>
          <ValueSpace>
            <Value>
              <Key>countdown</Key>
              <Name>Countdown</Name>
            </Value>
            <Value>
              <Key>timer</Key>
              <Name>Timer</Name>
            </Value>
            <Value>
              <Key>totime</Key>
              <Name>To Time</Name>
            </Value>
          </ValueSpace>
        </Widget>
      </Row>
      <Row>
        <Name>Display Target</Name>
        <Widget>
          <WidgetId>${CONFIG.widgetTarget}</WidgetId>
          <Type>GroupButton</Type>
          <Options>size=4</Options>
          <ValueSpace>
            <Value>
              <Key>osd</Key>
              <Name>OSD</Name>
            </Value>
            <Value>
              <Key>controller</Key>
              <Name>Controller</Name>
            </Value>
          </ValueSpace>
        </Widget>
      </Row>${durationRow}${toTimeRow}${timerInfoRow}
      <Row>
        <Name>Control</Name>
        <Widget>
          <WidgetId>${CONFIG.widgetStartStop}</WidgetId>
          <Name>Start / Stop</Name>
          <Type>Button</Type>
          <Options>size=2</Options>
        </Widget>
        <Widget>
          <WidgetId>${CONFIG.widgetReset}</WidgetId>
          <Name>Stop &amp; Clear</Name>
          <Type>Button</Type>
          <Options>size=2</Options>
        </Widget>
      </Row>
      <Row>
        <Widget>
          <WidgetId>${CONFIG.widgetOnScreenType}</WidgetId>
          <Name>OSD Type</Name>
          <Type>Button</Type>
          <Options>size=2</Options>
        </Widget>
        <Widget>
          <WidgetId>${CONFIG.widgetAudibleAlarmLabel}</WidgetId>
          <Name>Audible Alarm</Name>
          <Type>Text</Type>
          <Options>size=1;fontSize=small;align=center</Options>
        </Widget>
        <Widget>
          <WidgetId>${CONFIG.widgetAudibleAlarm}</WidgetId>
          <Type>ToggleButton</Type>
          <Options>size=1</Options>
        </Widget>
      </Row>
      <Row>
        <Name>Status</Name>
        <Widget>
          <WidgetId>${CONFIG.widgetStatus}</WidgetId>
          <Name>Ready</Name>
          <Type>Text</Type>
          <Options>size=4;fontSize=normal;align=center</Options>
        </Widget>
      </Row>
      <Options>hideRowNames=0</Options>
    </Page>
  </Panel>
</Extensions>`.trim();
}

/**
 * Re-save the panel with the current timerOption layout, then restore
 * all volatile widget values after a short delay for widget registration.
 */
async function rebuildPanel() {
  try {
    await xapi.Command.UserInterface.Extensions.Panel.Save(
      { PanelId: CONFIG.panelId },
      buildPanelXml()
    );
    debug(`Panel rebuilt for mode: ${timerOption}`);
  } catch (err) {
    console.error('Failed to rebuild panel:', err);
  }
  setTimeout(restoreWidgetValues, 500);
}

// ============================================================
// TARGET SWITCHING
// ============================================================

function handleTargetChange(newTarget) {
  if (newTarget === displayTarget) return;
  debug(`Display target: ${displayTarget} → ${newTarget}`);
  displayTarget = newTarget;

  if (newTarget === 'controller') {
    forceMessageClear();
    cancelExpiredTimeout();
  } else if (isRunning) {
    // Push current running state to OSD immediately
    const secs = timerOption === 'timer' ? elapsedSecs : remainingSecs;
    showMessage(formatTime(secs), currentAlertTitle());
  }
}

// ============================================================
// TIMER OPTION SWITCHING
// ============================================================

function handleTimerOptionChange(newOption) {
  if (newOption === timerOption) return;
  debug(`Timer option: ${timerOption} → ${newOption}`);
  timerOption = newOption;

  // Rebuild panel to show/hide the relevant rows
  rebuildPanel();

  // Update status to reflect the newly selected mode
  if (!isRunning) {
    if (timerOption === 'countdown') {
      const total = minuteVal * 60 + secondVal;
      setStatusWidget(total > 0 ? `Set:  ${formatTime(total)}` : 'Set a duration');
    } else if (timerOption === 'timer') {
      setStatusWidget('Timer mode — press Start');
    } else if (timerOption === 'totime') {
      setStatusWidget(toTimeTarget ? `To Time: ${toTimeTarget}` : 'Enter a target time');
    }
  }
}

// ============================================================
// SPINNER LOGIC
// ============================================================

function handleSpinner(widgetId, direction) {
  if (widgetId === CONFIG.widgetMinutes) {
    minuteVal = direction === 'increment'
      ? Math.min(99, minuteVal + 1)
      : Math.max(0,  minuteVal - 1);
    setSpinnerDisplay(CONFIG.widgetMinutes, minuteVal);
  }

  if (widgetId === CONFIG.widgetSeconds) {
    secondVal = direction === 'increment'
      ? Math.min(55, secondVal + 5)
      : Math.max(0,  secondVal - 5);
    setSpinnerDisplay(CONFIG.widgetSeconds, secondVal);
  }

  const total = minuteVal * 60 + secondVal;
  setStatusWidget(total > 0 ? `Set:  ${formatTime(total)}` : 'Set a duration');
}

// ============================================================
// TO TIME — PARSING
// ============================================================

/** Return the current local time as a 4-digit string, e.g. "1430" for 14:30. */
function currentTimeHHMM() {
  const now = new Date();
  const h   = String(now.getHours()).padStart(2, '0');
  const m   = String(now.getMinutes()).padStart(2, '0');
  return `${h}${m}`;
}

/**
 * Parse a 4-digit 24-hour time string entered without a colon (e.g. "1430").
 * Returns { h, m } or null if invalid.
 */
function parseClockTime(input) {
  const raw = String(input).trim().replace(/\D/g, ''); // strip any non-digits
  if (raw.length !== 4) return null;
  const h = parseInt(raw.slice(0, 2), 10);
  const m = parseInt(raw.slice(2, 4), 10);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}

/**
 * Calculate seconds from now until the given HH:MM target.
 * If the target has already passed today, it targets tomorrow.
 */
function secsUntilTime(h, m) {
  const now    = new Date();
  const target = new Date();
  target.setHours(h, m, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return Math.round((target - now) / 1000);
}

// ============================================================
// COUNTDOWN MODE
// ============================================================

function startCountdown() {
  if (isRunning) return;

  const total = minuteVal * 60 + secondVal;
  if (total <= 0) {
    setStatusWidget('Set a duration first');
    return;
  }

  cancelExpiredTimeout();
  isRunning     = true;
  remainingSecs = total;

  debug(`Countdown started: ${formatTime(remainingSecs)}`);
  setStatusWidget(`Running  ${formatTime(remainingSecs)}`);
  showMessage(formatTime(remainingSecs), CONFIG.alertCountdownTitle);

  timerInterval = setInterval(() => {
    remainingSecs -= 1;

    if (remainingSecs <= 0) {
      remainingSecs = 0;
      finishTimer();
      return;
    }

    setStatusWidget(`Running  ${formatTime(remainingSecs)}`);

    if (remainingSecs <= CONFIG.flashThresholdSecs) {
      if (remainingSecs % 2 !== 0) {
        showMessage(formatTime(remainingSecs), CONFIG.alertCountdownTitle);
      } else {
        clearMessage();
      }
    } else {
      showMessage(formatTime(remainingSecs), CONFIG.alertCountdownTitle);
    }
  }, CONFIG.tickIntervalMs);
}

// ============================================================
// TIMER MODE  (count up)
// ============================================================

function startTimer() {
  if (isRunning) return;

  cancelTimerAutoReset();
  cancelExpiredTimeout();
  isRunning   = true;
  elapsedSecs = 0;

  debug('Timer started.');
  setStatusWidget(`Timer  ${formatTime(elapsedSecs)}`);
  showMessage(formatTime(elapsedSecs), CONFIG.alertTimerTitle);

  timerInterval = setInterval(() => {
    elapsedSecs += 1;

    if (elapsedSecs >= CONFIG.timerMaxMins * 60) {
      debug(`Timer reached ${CONFIG.timerMaxMins}-minute limit — triggering Stop & Clear.`);
      resetAll();
      return;
    }

    setStatusWidget(`Timer  ${formatTime(elapsedSecs)}`);
    showMessage(formatTime(elapsedSecs), CONFIG.alertTimerTitle);
  }, CONFIG.tickIntervalMs);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  isRunning = false;

  debug(`Timer stopped at ${formatTime(elapsedSecs)}.`);
  setStatusWidget(`Stopped  ${formatTime(elapsedSecs)}`);
  // Leave the elapsed time on-screen so the room can see it

  // Auto-run Stop & Clear after configured inactivity period
  timerAutoReset = setTimeout(() => {
    debug('Timer auto-reset after inactivity.');
    resetAll();
  }, CONFIG.timerAutoResetMins * 60 * 1000);
}

// ============================================================
// TO TIME MODE  (count down to a wall clock time)
// ============================================================

function startToTime() {
  if (isRunning) return;

  const parsed = parseClockTime(toTimeTarget);
  if (!parsed) {
    setStatusWidget('Enter a valid time (HH:MM)');
    return;
  }

  const secs = secsUntilTime(parsed.h, parsed.m);
  if (secs <= 0) {
    setStatusWidget('Target time already passed');
    return;
  }

  cancelExpiredTimeout();
  isRunning     = true;
  remainingSecs = secs;

  debug(`To Time started: ${toTimeTarget} (${secs}s away)`);
  setStatusWidget(`To ${toTimeTarget}  ${formatTime(remainingSecs)}`);
  showMessage(formatTime(remainingSecs), CONFIG.alertToTimeTitle);

  timerInterval = setInterval(() => {
    remainingSecs -= 1;

    if (remainingSecs <= 0) {
      remainingSecs = 0;
      finishTimer();
      return;
    }

    setStatusWidget(`To ${toTimeTarget}  ${formatTime(remainingSecs)}`);

    if (remainingSecs <= CONFIG.flashThresholdSecs) {
      if (remainingSecs % 2 !== 0) {
        showMessage(formatTime(remainingSecs), CONFIG.alertToTimeTitle);
      } else {
        clearMessage();
      }
    } else {
      showMessage(formatTime(remainingSecs), CONFIG.alertToTimeTitle);
    }
  }, CONFIG.tickIntervalMs);
}

// ============================================================
// AUDIBLE ALARM
// ============================================================

function activateAlarm() {
  alarmActive = true;
  xapi.Command.Audio.SoundsAndAlerts.Ringtone.Play({ Loop: 'On', RingTone: CONFIG.alarmRingTone });
  alarmTimeout = setTimeout(deactivateAlarm, CONFIG.alarmDuration * 1000);
  xapi.Command.UserInterface.Message.Prompt.Display({
    FeedbackId: CONFIG.alarmFeedbackId,
    Title:      CONFIG.alarmTitle,
    Text:       CONFIG.alarmText,
    'Option.1': 'Dismiss',
  });
}

function deactivateAlarm() {
  if (!alarmActive) return;
  alarmActive = false;
  if (alarmTimeout) { clearTimeout(alarmTimeout); alarmTimeout = null; }
  xapi.Command.Audio.SoundsAndAlerts.Ringtone.Stop()
    .catch(err => debug('Ringtone.Stop error:', err));
}

// ============================================================
// SHARED FINISH / STOP / RESET
// ============================================================

/** Called when Countdown or To Time reaches zero. */
function finishTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  isRunning = false;

  debug('Timer finished.');
  showMessage(CONFIG.expiredText, CONFIG.alertExpiredTitle);
  setStatusWidget('Finished!');
  if (audibleAlarmEnabled) activateAlarm();

  expiredTimeout = setTimeout(() => {
    clearAllMessages();
    expiredTimeout = null;
  }, CONFIG.expiredDisplaySecs * 1000);

  // Reset display target back to OSD
  displayTarget = 'osd';
  syncAllGroupButtons();
}

/** Called when Start/Stop is pressed to manually stop a running timer. */
function stopCurrent() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  isRunning = false;

  if (timerOption === 'timer') {
    stopTimer();  // handles its own status and auto-reset
    return;
  }

  // Countdown or To Time — stopped by user
  cancelExpiredTimeout();
  clearMessage();
  setStatusWidget(`Stopped at  ${formatTime(remainingSecs)}`);
  debug('Stopped by user.');
}

/** Stop & Clear — halts everything and resets to a clean state. */
function resetAll() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  isRunning = false;
  cancelExpiredTimeout();
  cancelTimerAutoReset();
  deactivateAlarm();
  forceMessageClear();
  setStatusWidget('Reset');
  displayTarget = 'osd';
  syncAllGroupButtons();
  debug('Reset.');
}

/** Route the Start/Stop button press to the correct mode handler. */
function handleStartStop() {
  if (isRunning) {
    stopCurrent();
  } else {
    cancelTimerAutoReset();
    if (timerOption === 'countdown') {
      startCountdown();
    } else if (timerOption === 'timer') {
      startTimer();
    } else if (timerOption === 'totime') {
      startToTime();
    }
  }
}

// ============================================================
// INIT
// ============================================================

async function init() {
  debug(`OnScreen Countdown v${CURRENT_VERSION} initialising…`);

  try {
    await xapi.Command.UserInterface.Extensions.Panel.Save(
      { PanelId: CONFIG.panelId },
      buildPanelXml()
    );
    debug(`Panel '${CONFIG.panelId}' saved.`);
  } catch (err) {
    console.error('Failed to save panel:', err);
  }

  // Sync both GroupButtons and spinners after a short delay to ensure widgets are registered
  setTimeout(() => {
    restoreWidgetValues();
    setStatusWidget(`Ready  (v${CURRENT_VERSION})`);
  }, 1500);

  // Re-sync widget values every time the panel is opened
  xapi.Event.UserInterface.Extensions.Panel.Opened.on(event => {
    if (event.PanelId !== CONFIG.panelId) return;
    debug(`Panel opened — restoring widget values`);
    restoreWidgetValues();
  });

  xapi.Event.UserInterface.Extensions.Widget.Action.on(event => {
    const { WidgetId, Type, Value } = event;

    // Timer Options GroupButton
    if (WidgetId === CONFIG.widgetTimerOption && Type === 'pressed') {
      handleTimerOptionChange(Value);
    }

    // Display Target GroupButton
    if (WidgetId === CONFIG.widgetTarget && Type === 'pressed') {
      handleTargetChange(Value);
    }

    // Spinners (fire Type: 'pressed' with Value: 'increment' or 'decrement')
    if ((WidgetId === CONFIG.widgetMinutes || WidgetId === CONFIG.widgetSeconds)
        && Type === 'pressed') {
      handleSpinner(WidgetId, Value);
    }

    // Set Time button — opens TextInput popup for To Time mode
    if (WidgetId === CONFIG.widgetSetTime && Type === 'clicked') {
      xapi.Command.UserInterface.Message.TextInput.Display({
        Title:       'Set Target Time',
        Text:        'Enter the time in 24-hour format — 4 digits, no colon (e.g. 1430 for 14:30)',
        InputText:   currentTimeHHMM(),
        InputType:   'Numeric',
        SubmitText:  'Set',
        FeedbackId:  CONFIG.toTimeFeedbackId,
      }).catch(err => console.error('TextInput.Display error:', err));
    }

    // Start / Stop
    if (WidgetId === CONFIG.widgetStartStop && Type === 'clicked') {
      handleStartStop();
    }

    // Stop & Clear
    if (WidgetId === CONFIG.widgetReset && Type === 'clicked') {
      resetAll();
    }

    // Audible Alarm toggle
    if (WidgetId === CONFIG.widgetAudibleAlarm && Type === 'changed') {
      audibleAlarmEnabled = Value === 'on';
      debug(`Audible alarm ${audibleAlarmEnabled ? 'enabled' : 'disabled'}.`);
    }

    // On Screen Location — choose display mode
    if (WidgetId === CONFIG.widgetOnScreenType && Type === 'clicked') {
      xapi.Command.UserInterface.Message.Prompt.Display({
        FeedbackId:  CONFIG.displayModeFeedbackId,
        Title:       'On Screen Alert Type',
        Text:        'Choose how the timer is displayed on screen',
        'Option.1':  'Bottom of Screen',
        'Option.2':  'Top Right Alert',
      }).catch(err => console.error('DisplayMode prompt error:', err));
    }
  });

  // On Screen Location prompt response — set display mode
  xapi.Event.UserInterface.Message.Prompt.Response.on(event => {
    if (event.FeedbackId !== CONFIG.displayModeFeedbackId) return;
    deviceMode = event.OptionId === '1' ? 'textline' : 'alert';
    debug(`Display mode set to: ${deviceMode}`);
    setStatusWidget(`Mode: ${deviceMode === 'textline' ? 'Bottom of Screen' : 'Top Right Alert'}`);
  });

  // TextInput response — validate and store the To Time value
  xapi.Event.UserInterface.Message.TextInput.Response.on(event => {
    if (event.FeedbackId !== CONFIG.toTimeFeedbackId) return;
    const value  = event.Text.trim();
    const parsed = parseClockTime(value);
    if (parsed) {
      // Store and display as HH:MM for readability
      const formatted = `${String(parsed.h).padStart(2, '0')}:${String(parsed.m).padStart(2, '0')}`;
      toTimeTarget = formatted;
      xapi.Command.UserInterface.Extensions.Widget.SetValue({
        WidgetId: CONFIG.widgetToTimeDisplay,
        Value:    formatted,
      }).catch(err => console.error('ToTime display error:', err));
      setStatusWidget(`To Time: ${formatted}`);
      debug(`To Time target set: "${formatted}"`);
    } else {
      setStatusWidget('Invalid — enter 4 digits e.g. 1430');
    }
  });

  // Dismiss button on alarm prompt stops the ringtone
  xapi.Event.UserInterface.Message.Prompt.Response.on(event => {
    if (event.FeedbackId !== CONFIG.alarmFeedbackId) return;
    debug('Alarm dismissed by user — deactivating alarm.');
    deactivateAlarm();
  });

  // Reset when an outbound call connects
  xapi.Event.CallSuccessful.on(() => {
    debug('Outbound call connected — triggering Stop & Clear.');
    if (isRunning) resetAll();
  });

  // Reset when an inbound call arrives (rings)
  xapi.Event.IncomingCallReceived.on(() => {
    debug('Incoming call received — triggering Stop & Clear.');
    if (isRunning) resetAll();
  });

  debug(`OnScreen Countdown ready. Mode: ${deviceMode}`);
}

init();
