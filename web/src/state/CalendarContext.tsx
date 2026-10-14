import { createContext, useContext, useState, type ReactNode } from "react";

// Above the routed page, so leaving Calendar and coming back keeps the month.
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
