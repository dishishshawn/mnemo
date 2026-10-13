import { inputClass } from "./ui";

const LANGUAGES = [
  "English", "Spanish", "French", "German", "Italian", "Portuguese", "Dutch", "Polish", "Czech", "Slovak",
  "Hungarian", "Romanian", "Bulgarian", "Greek", "Swedish", "Norwegian", "Danish", "Finnish", "Icelandic",
  "Estonian", "Latvian", "Lithuanian", "Ukrainian", "Russian", "Serbian", "Croatian", "Slovenian", "Turkish",
  "Arabic", "Hebrew", "Persian", "Urdu", "Hindi", "Bengali", "Punjabi", "Gujarati", "Marathi", "Tamil",
  "Telugu", "Kannada", "Malayalam", "Sinhala", "Nepali", "Thai", "Vietnamese", "Indonesian", "Malay",
  "Filipino", "Chinese (Simplified)", "Chinese (Traditional)", "Japanese", "Korean", "Swahili", "Amharic",
  "Yoruba", "Zulu", "Afrikaans", "Catalan", "Basque", "Galician", "Irish", "Welsh", "Latin",
];

export function LanguageSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="auto">Same as the material</option>
      {LANGUAGES.map((l) => (
        <option key={l} value={l}>
          {l}
        </option>
      ))}
    </select>
  );
}
