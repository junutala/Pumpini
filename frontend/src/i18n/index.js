// src/i18n/index.js
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en.json';
import hi from './locales/hi.json';
import ta from './locales/ta.json';
import te from './locales/te.json';
import kn from './locales/kn.json';
import mr from './locales/mr.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, hi: { translation: hi },
                 ta: { translation: ta }, te: { translation: te },
                 kn: { translation: kn }, mr: { translation: mr } },
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    detection: { order: ['localStorage','navigator'], caches: ['localStorage'] },
  });

export default i18n;

export const LANGUAGES = [
  { code: 'en', label: 'English',    native: 'English' },
  { code: 'hi', label: 'Hindi',      native: 'हिन्दी' },
  { code: 'ta', label: 'Tamil',      native: 'தமிழ்' },
  { code: 'te', label: 'Telugu',     native: 'తెలుగు' },
  { code: 'kn', label: 'Kannada',    native: 'ಕನ್ನಡ' },
  { code: 'mr', label: 'Marathi',    native: 'मराठी' },
];
