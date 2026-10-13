import { Paperclip } from "lucide-react";
import { useId, useState } from "react";
import { useT } from "../i18n/I18nContext";

// File picker in the CRM's language. The native <input type="file"> draws
// its own "Choose file / No file chosen" text in the *browser's* language
// (Portuguese on a pt-BR Chrome even with English selected in the app), so
// the real input is visually hidden inside a styled label and the chosen
// file name is shown by us. Still a real file input: keyboard focus, Enter/
// Space to open, and drag-and-drop onto it all keep working.
export default function FileButton({ accept, disabled, onFiles, label, resetAfterPick = false }: {
  accept?: string;
  disabled?: boolean;
  onFiles: (files: FileList | null) => void;
  // Visible button text; defaults to "Choose file".
  label?: string;
  // Clear the selection after each pick (upload-style inputs that should
  // accept the same file twice).
  resetAfterPick?: boolean;
}) {
  const { t } = useT();
  const id = useId();
  const [fileName, setFileName] = useState("");
  return (
    <span className={`file-btn${disabled ? " disabled" : ""}`}>
      <label htmlFor={id} className="btn ghost slim">
        <Paperclip aria-hidden="true" />{label || t("file.choose")}
      </label>
      <input
        id={id}
        className="sr-only"
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={e => {
          setFileName(resetAfterPick ? "" : e.target.files?.[0]?.name || "");
          onFiles(e.target.files);
          if (resetAfterPick) e.target.value = "";
        }}
      />
      <span className="file-btn-name" aria-live="polite">{fileName || (resetAfterPick ? "" : t("file.none"))}</span>
    </span>
  );
}
