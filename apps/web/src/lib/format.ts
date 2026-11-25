import { useMemo } from "react";
import { INTL_LOCALE, useLocale, type Locale } from "@/i18n";

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

/** Dates, times and numbers: US English in the app, German in a German request form. */
export function createFormatter(locale: Locale, now: () => number = Date.now) {
  const tag = INTL_LOCALE[locale];
  const dateTime = new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short" });
  const dateOnly = new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeZone: "UTC" });
  const number = new Intl.NumberFormat(tag);
  const relative = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
  return {
    dateTime: (iso: string) => dateTime.format(new Date(iso)),
    number: (value: number) => number.format(value),
    /** A calendar date (YYYY-MM-DD), the same everywhere. */
    date: (value: string) => dateOnly.format(new Date(`${value.slice(0, 10)}T00:00:00Z`)),
    /** File sizes: 812 B, 14 KB, 2.3 MB. */
    bytes: (value: number) =>
      value < 1024
        ? `${number.format(value)} B`
        : value < 1024 * 1024
          ? `${number.format(Math.round(value / 1024))} KB`
          : `${new Intl.NumberFormat(tag, { maximumFractionDigits: 1 }).format(value / 1024 / 1024)} MB`,
    /** "3 minutes ago", "yesterday". */
    relative: (iso: string) => {
      const seconds = Math.round((new Date(iso).getTime() - now()) / 1000);
      for (const [unit, size] of UNITS) {
        if (Math.abs(seconds) >= size || unit === "second") {
          return relative.format(Math.round(seconds / size), unit);
        }
      }
      return relative.format(0, "second");
    },
  };
}

export type Formatter = ReturnType<typeof createFormatter>;

export function useFormatter(): Formatter {
  const locale = useLocale();
  return useMemo(() => createFormatter(locale), [locale]);
}
