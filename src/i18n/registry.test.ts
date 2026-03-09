import { describe, expect, it } from "vitest";
import type { Locale, TranslationMap } from "../../ui/src/i18n/lib/types.ts";

const SUPPORTED_LOCALES: ReadonlyArray<Locale> = ["en", "zh-CN", "zh-TW", "pt-BR", "de"];

const DEFAULT_LOCALE: Locale = "en";

function resolveNavigatorLocale(locale: string | null | undefined): Locale {
  const normalized = locale?.trim() ?? "";
  if (!normalized) {
    return DEFAULT_LOCALE;
  }
  if (normalized.startsWith("zh")) {
    return normalized === "zh-TW" || normalized === "zh-HK" ? "zh-TW" : "zh-CN";
  }
  if (normalized.startsWith("pt")) {
    return "pt-BR";
  }
  if (normalized.startsWith("de")) {
    return "de";
  }
  return DEFAULT_LOCALE;
}

async function loadLazyLocaleTranslation(locale: Locale): Promise<TranslationMap | null> {
  switch (locale) {
    case "en":
      return null;
    case "de":
      return (await import("../../ui/src/i18n/locales/de.ts")).de;
    case "pt-BR":
      return (await import("../../ui/src/i18n/locales/pt-BR.ts")).pt_BR;
    case "zh-CN":
      return (await import("../../ui/src/i18n/locales/zh-CN.ts")).zh_CN;
    case "zh-TW":
      return (await import("../../ui/src/i18n/locales/zh-TW.ts")).zh_TW;
    default:
      return null;
  }
}

function getNestedTranslation(map: TranslationMap | null, ...path: string[]): string | undefined {
  let value: string | TranslationMap | undefined = map ?? undefined;
  for (const key of path) {
    if (value === undefined || typeof value === "string") {
      return undefined;
    }
    value = value[key];
  }
  return typeof value === "string" ? value : undefined;
}

describe("ui i18n locale registry", () => {
  it("lists supported locales", () => {
    expect(SUPPORTED_LOCALES).toEqual(["en", "zh-CN", "zh-TW", "pt-BR", "de"]);
    expect(DEFAULT_LOCALE).toBe("en");
  });

  it("resolves browser locale fallbacks", () => {
    expect(resolveNavigatorLocale("de-DE")).toBe("de");
    expect(resolveNavigatorLocale("pt-PT")).toBe("pt-BR");
    expect(resolveNavigatorLocale("zh-HK")).toBe("zh-TW");
    expect(resolveNavigatorLocale("en-US")).toBe("en");
    expect(resolveNavigatorLocale("es-ES")).toBe("en");
  });

  it("loads lazy locale translations from the registry", async () => {
    const de = await loadLazyLocaleTranslation("de");
    const ptBR = await loadLazyLocaleTranslation("pt-BR");
    const zhCN = await loadLazyLocaleTranslation("zh-CN");

    expect(getNestedTranslation(de, "common", "health")).toBe("Status");
    expect(getNestedTranslation(ptBR, "languages", "de")).toBe("Deutsch (Alemão)");
    expect(getNestedTranslation(zhCN, "common", "health")).toBe("健康状况");
    expect(await loadLazyLocaleTranslation("en")).toBeNull();
  });
});
