import { Search, X } from "lucide-react";
import { useT } from "../i18n/I18nContext";
import { useSearch } from "../state/SearchContext";

// A visible search box for a list page. Same query as the top bar's search.
export default function SearchField({ placeholder }: { placeholder: string }) {
  const { searchText, setSearchText } = useSearch();
  const { t } = useT();
  return (
    <div className="search-pill">
      <Search aria-hidden="true" />
      <input
        type="search"
        value={searchText}
        onChange={e => setSearchText(e.target.value)}
        onKeyDown={e => { if (e.key === "Escape") setSearchText(""); }}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      {searchText && (
        <button type="button" className="search-pill-clear" onClick={() => setSearchText("")} aria-label={t("search.clear")}>
          <X aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
