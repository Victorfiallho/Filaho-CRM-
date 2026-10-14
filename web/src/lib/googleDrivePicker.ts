// Google Picker: browse and attach a real Drive file. Needs the Drive OAuth
// token (connectGoogleWorkspace(clientId, "drive"), scope drive.file) and a
// Picker API key (google_drive.picker_api_key), which is a public browser
// key, not a secret.
declare global {
  interface Window { gapi?: any; google?: any }
}

let gapiLoadPromise: Promise<void> | null = null;

function loadGapi(): Promise<void> {
  if (window.gapi?.picker) return Promise.resolve();
  if (gapiLoadPromise) return gapiLoadPromise;
  gapiLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector("script[data-gapi]");
    if (existing) {
      existing.addEventListener("load", () => loadPickerModule().then(resolve, reject), { once: true });
      existing.addEventListener("error", () => reject(new Error("Could not load Google Picker.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.async = true;
    script.defer = true;
    script.dataset.gapi = "true";
    script.onload = () => loadPickerModule().then(resolve, reject);
    script.onerror = () => reject(new Error("Could not load Google Picker."));
    document.head.appendChild(script);
  });
  return gapiLoadPromise;
}

function loadPickerModule(): Promise<void> {
  return new Promise((resolve, reject) => {
    window.gapi.load("picker", { callback: () => resolve(), onerror: () => reject(new Error("Could not load the Picker module.")) });
  });
}

export type PickedDriveFile = { name: string; url: string };

export async function openDrivePicker(accessToken: string, developerKey: string): Promise<PickedDriveFile | null> {
  await loadGapi();
  return new Promise((resolve, reject) => {
    const picker = new window.google.picker.PickerBuilder()
      .addView(window.google.picker.ViewId.DOCS)
      .setOAuthToken(accessToken)
      .setDeveloperKey(developerKey)
      .setCallback((data: any) => {
        if (data.action === window.google.picker.Action.PICKED) {
          const doc = data.docs[0];
          resolve({ name: doc.name, url: doc.url });
        } else if (data.action === window.google.picker.Action.CANCEL) {
          resolve(null);
        }
      })
      .build();
    try {
      picker.setVisible(true);
    } catch (error) {
      reject(error instanceof Error ? error : new Error("Could not open Google Picker."));
    }
  });
}
