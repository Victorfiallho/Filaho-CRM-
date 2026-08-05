import { createContext, useContext, useState, type ReactNode } from "react";

// Lifted above the routed page (like app.js's module-level `calendarDate`
// global) so navigating away from Calendar and back doesn't reset the month.
interface CalendarContextValue {
  calendarDate: Date;
  setCalendarDate: (date: Date) => void;
}

const CalendarContext = createContext<CalendarContextValue | null>(null);

export function CalendarProvider({ children }: { children: ReactNode }) {
  const [calendarDate, setCalendarDate] = useState(new Date());
  return <CalendarContext.Provider value={{ calendarDate, setCalendarDate }}>{children}</CalendarContext.Provider>;
}

export function useCalendar() {
  const ctx = useContext(CalendarContext);
  if (!ctx) throw new Error("useCalendar must be used within CalendarProvider");
  return ctx;
}
