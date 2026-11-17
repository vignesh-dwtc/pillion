import IDENTITY from '../../config/identity.json';

/**
 * Every user-visible string lives here (one place to localise later). The product name only ever comes from
 * config/identity.json. Screens must not hard-code copy.
 */
const name = IDENTITY.displayName;

export const strings = {
  appName: name,

  common: {
    back: 'Back',
    backLabel: 'Go back',
    cancel: 'Cancel',
    on: 'On',
    off: 'Off',
    notAvailable: 'n/a',
    yes: 'Yes',
    no: 'No',
  },

  placeholder: {
    tag: 'Placeholder',
    ride: 'Placeholder: there is no live session yet. Everything on this screen is sample state.',
    diagnostics:
      'Sample data: no ride is running, so these are example values. Live values arrive with the session.',
    startNote:
      'Start opens the placeholder ride screen. The live session is connected in the next milestone.',
  },

  onboarding: {
    title: `Welcome to ${name}`,
    intro: 'A hands-free voice link between two phones on one bike. It works without any mobile signal.',
    steps: [
      'Keep your phone in your pocket and wear your own earbuds.',
      'Each of you opens the app and taps Start. The link comes up on its own.',
      'Short sounds tell you when you are connected, disconnected or muted.',
    ],
    safety: 'Set everything up before you ride. Never handle your phone while the bike is moving.',
    permissionsHeading: 'Allow these so rides keep working with the screen off',
    permissionsNote: 'You can change any of these later in your phone settings.',
    allow: 'Allow',
    openSettings: 'Open settings',
    continue: 'Continue',
    permissionError: 'Could not ask for this permission. Try again.',
    permissions: {
      microphone: {
        title: 'Microphone',
        why: 'Lets your partner hear you. Audio is never recorded or stored.',
      },
      notifications: {
        title: 'Notifications',
        why: 'Shows the ride notification with Mute and End buttons and keeps the ride alive in your pocket.',
      },
      bluetooth: {
        title: 'Bluetooth headset',
        why: 'Lets the app use your Bluetooth earbuds for the call.',
      },
      nearbyDevices: {
        title: 'Nearby devices',
        why: 'Lets the two phones find each other directly, without a router.',
      },
    },
    status: {
      granted: 'Allowed',
      denied: 'Not allowed yet',
      blocked: 'Blocked in system settings',
      undetermined: 'Not asked yet',
      unavailable: 'Not needed on this phone',
    },
  },

  home: {
    tagline: 'Hands-free intercom for two',
    partnerHeading: 'Your partner',
    notPaired: 'Not paired yet',
    notPairedHint: 'Pair once, then every ride is one tap.',
    pairedWith: (partner: string) => `Paired with ${partner}`,
    partnerFallback: 'your partner',
    roleHost: 'You showed the code (host)',
    roleGuest: 'You scanned the code (guest)',
    pairingsError: 'Could not read the saved pairing. Pairing again will fix it.',
    start: 'Start ride',
    startHint: 'Both phones tap Start.',
    pairHeading: 'Pair with your partner',
    pairHost: 'Show my code',
    pairHostHint: 'I am the host, usually the rider',
    pairGuest: 'Scan partner code',
    pairGuestHint: 'I am the guest, usually the passenger',
    settings: 'Settings',
    diagnostics: 'Diagnostics',
  },

  pairHost: {
    title: 'Show your code',
    instruction: 'On your partner’s phone, choose “Scan partner code” and point the camera at this code.',
    sampleChip: 'Sample code, not a real pairing',
    qrLabel: 'Sample QR code. A real pairing code is shown in the next milestone.',
    waiting: 'Waiting for your partner to scan…',
    cancel: 'Cancel pairing',
  },

  pairGuest: {
    title: 'Scan partner code',
    instruction:
      'Hold your phone 20 to 30 cm from your partner’s screen until the code fits inside the frame.',
    viewfinder: 'Camera preview appears here',
    viewfinderNote: 'The camera is switched on together with pairing in the next milestone.',
    viewfinderLabel: 'Camera viewfinder placeholder',
    devHeading: 'Developer: paste pairing string',
    devLabel: 'Pairing string',
    devPlaceholder: 'Paste pairing string',
    devButton: 'Pair with this string',
    devPending: 'Pairing is wired up in the next milestone. Nothing was saved.',
    cancel: 'Cancel pairing',
  },

  ride: {
    title: 'Ride',
    states: {
      idle: 'Not started',
      starting: 'Starting',
      linking: 'Looking for your partner',
      signaling: 'Securing the link',
      connecting: 'Connecting audio',
      connected: 'Connected',
      reconnecting: 'Reconnecting',
      ended: 'Ride ended',
    },
    statusWith: (partner: string) => `with ${partner}`,
    headsetConnected: 'Headset connected',
    headsetMissing: 'No headset',
    headsetDetail: (device: string) => `Audio goes to ${device}`,
    partnerMicOn: 'Partner microphone: on',
    partnerMicMuted: 'Partner microphone: muted',
    mute: 'Mute',
    muted: 'Muted',
    muteHint: 'Tap to mute your microphone',
    unmuteHint: 'Tap to unmute',
    muteLabel: 'Mute microphone',
    end: 'End ride',
    endLabel: 'End ride',
  },

  settings: {
    title: 'Settings',
    deviceHeading: 'This phone',
    deviceNameLabel: 'Your name',
    deviceNameHint: 'Your partner sees this name.',
    deviceNamePlaceholder: 'Name',
    defaultDeviceName: 'My phone',
    setupHeading: 'Setup',
    permissions: 'Permissions and setup',
    permissionsHint: 'Microphone, notifications, Bluetooth, nearby devices',
    diagnostics: 'Diagnostics',
    diagnosticsHint: 'Connection details you can share',
    advancedHeading: 'Advanced',
    developerMode: 'Developer mode',
    developerModeHint: 'Shows extra options for testing. Leave it off for normal rides.',
    partnerHeading: 'Paired partners',
    noPartner: 'No partner paired yet.',
    forget: 'Forget this partner',
    forgetConfirm: 'Tap again to forget',
    forgetLabel: (partner: string) => `Forget ${partner}`,
    versionLabel: (version: string) => `Version ${version}`,
    developerTapsRemaining: (n: number) => `${n} more ${n === 1 ? 'tap' : 'taps'} to open developer tools`,
    developerModeEnabled: 'Developer mode is on',
  },

  diagnostics: {
    title: 'Diagnostics',
    share: 'Share diagnostics',
    shareHint: 'Sends this report as text. It never contains the pairing secret or the Wi-Fi passphrase.',
    shared: 'Report handed to the share sheet.',
    shareUnavailable: 'Sharing is not available here. The report text is shown below instead.',
    reportHeading: 'Report text',
    sections: {
      session: 'Session',
      transport: 'Transport',
      interfaces: 'Local network interfaces',
      ice: 'ICE candidates',
      quality: 'Link quality',
      levels: 'Audio levels',
      route: 'Audio route',
      battery: 'Battery',
      log: 'Log (latest entries)',
    },
  },

  debug: {
    title: 'Developer tools',
    intro: 'Hidden screen for tuning on the road. Changes apply immediately and are saved on this phone.',
    tunablesHeading: 'Audio tunables',
    changed: 'Changed from default',
    allDefaults: 'All values are at their defaults.',
    bitratePresets: 'Bitrate presets',
    reset: 'Reset to defaults',
    resetDone: 'Defaults restored',
    stepDown: 'Decrease',
    stepUp: 'Increase',
    noiseSuppression: { label: 'Noise suppression', hint: 'Software noise suppression (libwebrtc).' },
    autoGainControl: { label: 'Automatic gain control', hint: 'Evens out loud and quiet speech.' },
    echoCancellation: { label: 'Echo cancellation', hint: 'Stops your partner from hearing themselves.' },
    highpassFilter: { label: 'High-pass filter', hint: 'Cuts low rumble such as wind and engine.' },
    opusBitrate: { label: 'Opus bitrate', hint: 'Higher sounds clearer and needs more bandwidth.' },
    opusFec: { label: 'Forward error correction', hint: 'Hides lost packets (Opus in-band FEC).' },
    opusDtx: {
      label: 'Discontinuous transmission',
      hint: 'Stops sending during silence. Can clip speech in wind.',
    },
    opusPacketTime: { label: 'Packet time', hint: 'Shorter means lower delay, longer is more robust.' },
    overridesHeading: 'Developer overrides',
    allowNoHeadset: {
      label: 'Allow earpiece or speaker',
      hint: 'Lets a ride start with no headset. For bench testing only.',
    },
    overridesLocked: 'Turn on developer mode in Settings to use the overrides.',
    developerModeOff: 'Developer mode is off',
  },
} as const;
