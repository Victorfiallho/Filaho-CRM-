import { createContext, useContext, useState, type ReactNode } from "react";

interface SearchContextValue {
  searchText: string;
  setSearchText: (value: string) => void;
}

const SearchContext = createContext<SearchContextValue | null>(null);

export function SearchProvider({ children }: { children: ReactNode }) {
  const [searchText, setSearchText] = useState("");
  return <SearchContext.Provider value={{ searchText, setSearchText }}>{children}</SearchContext.Provider>;
}

export function useSearch() {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error("useSearch must be used within SearchProvider");
  return ctx;
}
