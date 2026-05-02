export interface Settings {
  defaultModel: string;
  approvalTimeout: number;
  notificationsEnabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultModel: "sonnet",
  approvalTimeout: 60,
  notificationsEnabled: true,
};

export function getSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem("flock:settings") || "{}") };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings) {
  localStorage.setItem("flock:settings", JSON.stringify(settings));
}

export function settingsUpdatePayload(settings = getSettings()) {
  return {
    type: "settings:update",
    approvalTimeout: settings.approvalTimeout,
  };
}
