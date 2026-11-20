import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import logo from "../../assets/opencode.webp"

export function SettingsAbout() {
  const language = useLanguage()
  const platform = usePlatform()

  return (
    <div class="settings-about-content">
      <div class="settings-about-intro">
        <p>
          {language.t("settings.about.version", {
            version: platform.version ?? language.t("settings.about.devVersion"),
          })}
        </p>
        <p>{language.t("settings.about.license")}</p>
      </div>

      <div class="settings-about-brand">
        <img class="settings-about-logo" src={logo} alt="" />
        <p class="settings-about-fork">{language.t("settings.about.fork.name")}</p>
        <p class="settings-about-faint">
          <bdi dir="ltr">{language.t("settings.about.fork.basedOn")}</bdi>
        </p>
      </div>
    </div>
  )
}
