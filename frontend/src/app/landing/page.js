'use client';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Image from 'next/image';
import Link from 'next/link';

const LANGS = [
  { code:'en', label:'English',    flag:'🇬🇧' },
  { code:'hi', label:'हिन्दी',     flag:'🇮🇳' },
  { code:'ta', label:'தமிழ்',      flag:'🇮🇳' },
  { code:'te', label:'తెలుగు',     flag:'🇮🇳' },
  { code:'kn', label:'ಕನ್ನಡ',      flag:'🇮🇳' },
  { code:'mr', label:'मराठी',      flag:'🇮🇳' },
];

const COPY = {
  en: {
    hero:    'Control every drop.',
    hero2:   'Track every rupee.',
    sub:     'India\'s most complete petrol station management platform — built for owners who want real control.',
    cta:     'Start Free Trial',
    demo:    'Watch Demo',
    usp1_t:  '6 Indian Languages',
    usp1_d:  'Your staff works in Hindi, Tamil, Telugu, Kannada, Marathi or English. Everyone gets the app in their own language.',
    usp2_t:  'WhatsApp Updates',
    usp2_d:  'Ask your station anything on WhatsApp. Get daily summaries, alerts and reports — no app needed.',
    usp3_t:  'Credit Customer Portal',
    usp3_d:  'Give your corporate clients their own dashboard. Vehicle-wise GST invoices, outstanding balance, full statement.',
    usp4_t:  'Live Dashboard',
    usp4_d:  'Watch every sale as it happens — from your phone, anywhere in India. Real-time. No delays.',
    plans:   'Simple pricing',
    trial:   '30-day free trial · No credit card · Cancel anytime',
    nav_features: "Features",
    nav_pricing: "Pricing",
    nav_contact: "Contact",
    login: "Login",
    why_eyebrow: "WHY PUMPINI",
    why_title: "Everything your petrol bunk needs",
    why_sub: "Four features that set us apart from every other petrol station software in India",
    pricing_title: "Simple pricing",
    per_month: "/month",
    most_popular: "Most Popular",
    get_started: "Get Started",
    stations_count: "petrol stations across South India",
    whatsapp_ready: "WhatsApp Ready",
    cta_footer: "Join petrol stations across South India who trust Pumpini",
  },
  hi: {
    hero:    'हर बूंद पर नियंत्रण।',
    hero2:   'हर रुपये की निगरानी।',
    sub:     'भारत का सबसे उन्नत पेट्रोल स्टेशन प्रबंधन प्लेटफ़ॉर्म — असली नियंत्रण चाहने वाले मालिकों के लिए।',
    cta:     'मुफ़्त शुरू करें',
    demo:    'डेमो देखें',
    usp1_t:  '6 भारतीय भाषाएँ',
    usp1_d:  'आपके कर्मचारी हिंदी, तमिल, तेलुगु, कन्नड़, मराठी या अंग्रेज़ी में काम कर सकते हैं। सबको अपनी भाषा में ऐप मिलता है।',
    usp2_t:  'WhatsApp अपडेट',
    usp2_d:  'WhatsApp पर अपने पंप से कुछ भी पूछें। दैनिक रिपोर्ट, अलर्ट और रिपोर्ट — बिना किसी ऐप के।',
    usp3_t:  'क्रेडिट कस्टमर पोर्टल',
    usp3_d:  'अपने कॉर्पोरेट ग्राहकों को अलग डैशबोर्ड दें। वाहन-वार GST इनवॉइस, बकाया राशि, पूरा विवरण।',
    usp4_t:  'लाइव डैशबोर्ड',
    usp4_d:  'हर बिक्री को होते ही देखें — अपने फ़ोन से, भारत में कहीं से भी। रियल-टाइम। कोई देरी नहीं।',
    plans:   'सरल मूल्य निर्धारण',
    trial:   '30 दिन मुफ़्त परीक्षण · क्रेडिट कार्ड नहीं · कभी भी रद्द करें',
    nav_features: "विशेषताएँ",
    nav_pricing: "मूल्य",
    nav_contact: "संपर्क",
    login: "लॉगिन",
    why_eyebrow: "क्यों पंपिनी",
    why_title: "आपके पेट्रोल पंप की हर ज़रूरत",
    why_sub: "चार खूबियाँ जो हमें भारत के हर दूसरे पेट्रोल स्टेशन सॉफ़्टवेयर से अलग बनाती हैं",
    pricing_title: "सरल मूल्य निर्धारण",
    per_month: "/माह",
    most_popular: "सबसे लोकप्रिय",
    get_started: "शुरू करें",
    stations_count: "दक्षिण भारत के पेट्रोल पंप",
    whatsapp_ready: "WhatsApp तैयार",
    cta_footer: "दक्षिण भारत के उन पेट्रोल पंपों से जुड़ें जो पंपिनी पर भरोसा करते हैं",
  },
  ta: {
    hero:    'ஒவ்வொரு துளியும் உங்கள் கட்டுப்பாட்டில்.',
    hero2:   'ஒவ்வொரு ரூபாயும் உங்கள் கண்காணிப்பில்.',
    sub:     'இந்தியாவின் முழுமையான பெட்ரோல் நிலைய மேலாண்மை தளம் — உண்மையான கட்டுப்பாடு விரும்பும் உரிமையாளர்களுக்காக.',
    cta:     'இலவசமாக தொடங்கு',
    demo:    'டெமோ பார்க்க',
    usp1_t:  '6 இந்திய மொழிகள்',
    usp1_d:  'உங்கள் ஊழியர்கள் தமிழ், இந்தி, தெலுங்கு, கன்னடம், மராத்தி அல்லது ஆங்கிலத்தில் பணியாற்றலாம். அனைவருக்கும் அவரவர் மொழியில் செயலி.',
    usp2_t:  'வாட்ஸ்அப் அறிவிப்புகள்',
    usp2_d:  'வாட்ஸ்அப்பில் உங்கள் நிலையத்திடம் எதையும் கேளுங்கள். தினசரி சுருக்கம், எச்சரிக்கைகள், அறிக்கைகள் — செயலி தேவையில்லை.',
    usp3_t:  'கடன் வாடிக்கையாளர் தளம்',
    usp3_d:  'உங்கள் கார்பரேட் வாடிக்கையாளர்களுக்கு தனி டாஷ்போர்டு. வாகன வாரியான GST இன்வாய்ஸ், நிலுவைத் தொகை, முழு அறிக்கை.',
    usp4_t:  'நேரலை டாஷ்போர்டு',
    usp4_d:  'ஒவ்வொரு விற்பனையும் நிகழும்போதே பாருங்கள் — உங்கள் தொலைபேசியில், இந்தியாவின் எங்கிருந்தும். நிகழ்நேரம். தாமதம் இல்லை.',
    plans:   'எளிய விலை நிர்ணயம்',
    trial:   '30 நாள் இலவச சோதனை · கிரெடிட் கார்டு தேவையில்லை · எப்போது வேண்டுமானாலும் ரத்து செய்யலாம்',
    nav_features: "அம்சங்கள்",
    nav_pricing: "விலை",
    nav_contact: "தொடர்பு",
    login: "உள்நுழைவு",
    why_eyebrow: "ஏன் பம்பினி",
    why_title: "உங்கள் பெட்ரோல் நிலையத்தின் அனைத்து தேவைகளும்",
    why_sub: "இந்தியாவின் மற்ற எல்லா பெட்ரோல் நிலைய மென்பொருளிலிருந்தும் எங்களை வேறுபடுத்தும் நான்கு அம்சங்கள்",
    pricing_title: "எளிய விலை நிர்ணயம்",
    per_month: "/மாதம்",
    most_popular: "மிகவும் பிரபலம்",
    get_started: "தொடங்கு",
    stations_count: "தென்னிந்தியாவில் உள்ள பெட்ரோல் நிலையங்கள்",
    whatsapp_ready: "WhatsApp தயார்",
    cta_footer: "பம்பினியை நம்பும் தென்னிந்திய பெட்ரோல் நிலையங்களுடன் இணையுங்கள்",
  },
  te: {
    hero:    'ప్రతి చుక్కపై నియంత్రణ.',
    hero2:   'ప్రతి రూపాయిని ట్రాక్ చేయండి.',
    sub:     'భారతదేశపు అత్యంత సమగ్ర పెట్రోల్ స్టేషన్ నిర్వహణ వేదిక — నిజమైన నియంత్రణ కోరుకునే యజమానుల కోసం.',
    cta:     'ఉచితంగా ప్రారంభించండి',
    demo:    'డెమో చూడండి',
    usp1_t:  '6 భారతీయ భాషలు',
    usp1_d:  'మీ సిబ్బంది హిందీ, తమిళం, తెలుగు, కన్నడ, మరాఠీ లేదా ఆంగ్లంలో పని చేయవచ్చు. ప్రతి ఒక్కరికీ వారి భాషలో యాప్.',
    usp2_t:  'WhatsApp నవీకరణలు',
    usp2_d:  'WhatsApp లో మీ స్టేషన్‌ను ఏదైనా అడగండి. రోజువారీ సారాంశాలు, హెచ్చరికలు, నివేదికలు — యాప్ అవసరం లేదు.',
    usp3_t:  'క్రెడిట్ కస్టమర్ పోర్టల్',
    usp3_d:  'మీ కార్పొరేట్ క్లయింట్లకు వారి సొంత డాష్‌బోర్డ్ ఇవ్వండి. వాహనం వారీగా GST ఇన్‌వాయిస్‌లు, బకాయి, పూర్తి స్టేట్‌మెంట్.',
    usp4_t:  'లైవ్ డాష్‌బోర్డ్',
    usp4_d:  'ప్రతి అమ్మకాన్ని జరిగినప్పుడే చూడండి — మీ ఫోన్ నుండి, భారతదేశంలో ఎక్కడి నుండైనా. రియల్-టైమ్. ఆలస్యం లేదు.',
    plans:   'సరళమైన ధర',
    trial:   '30 రోజుల ఉచిత ట్రయల్ · క్రెడిట్ కార్డ్ అవసరం లేదు · ఎప్పుడైనా రద్దు చేయండి',
    nav_features: "ఫీచర్లు",
    nav_pricing: "ధర",
    nav_contact: "సంప్రదించండి",
    login: "లాగిన్",
    why_eyebrow: "ఎందుకు పంపిని",
    why_title: "మీ పెట్రోల్ బంక్ అవసరాలన్నీ",
    why_sub: "భారతదేశంలోని ప్రతి ఇతర పెట్రోల్ స్టేషన్ సాఫ్ట్‌వేర్ నుండి మమ్మల్ని వేరు చేసే నాలుగు ఫీచర్లు",
    pricing_title: "సరళమైన ధర",
    per_month: "/నెల",
    most_popular: "అత్యంత ప్రజాదరణ",
    get_started: "ప్రారంభించండి",
    stations_count: "దక్షిణ భారతదేశంలోని పెట్రోల్ స్టేషన్లు",
    whatsapp_ready: "WhatsApp సిద్ధం",
    cta_footer: "పంపినిని నమ్మే దక్షిణ భారత పెట్రోల్ స్టేషన్లతో చేరండి",
  },
  kn: {
    hero:    'ಪ್ರತಿ ಹನಿಯ ಮೇಲೆ ನಿಯಂತ್ರಣ.',
    hero2:   'ಪ್ರತಿ ರೂಪಾಯಿಯನ್ನು ಟ್ರ್ಯಾಕ್ ಮಾಡಿ.',
    sub:     'ಭಾರತದ ಅತ್ಯಂತ ಸಮಗ್ರ ಪೆಟ್ರೋಲ್ ನಿಲ್ದಾಣ ನಿರ್ವಹಣಾ ವೇದಿಕೆ — ನಿಜವಾದ ನಿಯಂತ್ರಣ ಬಯಸುವ ಮಾಲೀಕರಿಗಾಗಿ.',
    cta:     'ಉಚಿತವಾಗಿ ಪ್ರಾರಂಭಿಸಿ',
    demo:    'ಡೆಮೋ ನೋಡಿ',
    usp1_t:  '6 ಭಾರತೀಯ ಭಾಷೆಗಳು',
    usp1_d:  'ನಿಮ್ಮ ಸಿಬ್ಬಂದಿ ಹಿಂದಿ, ತಮಿಳು, ತೆಲುಗು, ಕನ್ನಡ, ಮರಾಠಿ ಅಥವಾ ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿ ಕೆಲಸ ಮಾಡಬಹುದು. ಪ್ರತಿಯೊಬ್ಬರಿಗೂ ತಮ್ಮ ಭಾಷೆಯಲ್ಲಿ ಆ್ಯಪ್.',
    usp2_t:  'WhatsApp ನವೀಕರಣಗಳು',
    usp2_d:  'WhatsApp ನಲ್ಲಿ ನಿಮ್ಮ ನಿಲ್ದಾಣವನ್ನು ಏನು ಬೇಕಾದರೂ ಕೇಳಿ. ದೈನಂದಿನ ಸಾರಾಂಶಗಳು, ಎಚ್ಚರಿಕೆಗಳು, ವರದಿಗಳು — ಆ್ಯಪ್ ಅಗತ್ಯವಿಲ್ಲ.',
    usp3_t:  'ಕ್ರೆಡಿಟ್ ಗ್ರಾಹಕ ಪೋರ್ಟಲ್',
    usp3_d:  'ನಿಮ್ಮ ಕಾರ್ಪೊರೇಟ್ ಗ್ರಾಹಕರಿಗೆ ಅವರದೇ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್ ನೀಡಿ. ವಾಹನವಾರು GST ಇನ್‌ವಾಯ್ಸ್, ಬಾಕಿ, ಪೂರ್ಣ ಹೇಳಿಕೆ.',
    usp4_t:  'ಲೈವ್ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್',
    usp4_d:  'ಪ್ರತಿ ಮಾರಾಟವನ್ನು ನಡೆಯುತ್ತಿರುವಂತೆಯೇ ನೋಡಿ — ನಿಮ್ಮ ಫೋನ್‌ನಿಂದ, ಭಾರತದ ಎಲ್ಲಿಂದಲಾದರೂ. ರಿಯಲ್-ಟೈಮ್. ವಿಳಂಬವಿಲ್ಲ.',
    plans:   'ಸರಳ ಬೆಲೆ',
    trial:   '30 ದಿನಗಳ ಉಚಿತ ಪ್ರಯೋಗ · ಕ್ರೆಡಿಟ್ ಕಾರ್ಡ್ ಅಗತ್ಯವಿಲ್ಲ · ಯಾವಾಗ ಬೇಕಾದರೂ ರದ್ದುಗೊಳಿಸಿ',
    nav_features: "ವೈಶಿಷ್ಟ್ಯಗಳು",
    nav_pricing: "ಬೆಲೆ",
    nav_contact: "ಸಂಪರ್ಕ",
    login: "ಲಾಗಿನ್",
    why_eyebrow: "ಏಕೆ ಪಂಪಿನಿ",
    why_title: "ನಿಮ್ಮ ಪೆಟ್ರೋಲ್ ಬಂಕ್‌ನ ಎಲ್ಲಾ ಅಗತ್ಯಗಳು",
    why_sub: "ಭಾರತದ ಪ್ರತಿಯೊಂದು ಇತರ ಪೆಟ್ರೋಲ್ ಸ್ಟೇಷನ್ ಸಾಫ್ಟ್‌ವೇರ್‌ನಿಂದ ನಮ್ಮನ್ನು ಪ್ರತ್ಯೇಕಿಸುವ ನಾಲ್ಕು ವೈಶಿಷ್ಟ್ಯಗಳು",
    pricing_title: "ಸರಳ ಬೆಲೆ",
    per_month: "/ತಿಂಗಳು",
    most_popular: "ಅತ್ಯಂತ ಜನಪ್ರಿಯ",
    get_started: "ಪ್ರಾರಂಭಿಸಿ",
    stations_count: "ದಕ್ಷಿಣ ಭಾರತದ ಪೆಟ್ರೋಲ್ ಸ್ಟೇಷನ್‌ಗಳು",
    whatsapp_ready: "WhatsApp ಸಿದ್ಧ",
    cta_footer: "ಪಂಪಿನಿಯನ್ನು ನಂಬುವ ದಕ್ಷಿಣ ಭಾರತದ ಪೆಟ್ರೋಲ್ ಸ್ಟೇಷನ್‌ಗಳೊಂದಿಗೆ ಸೇರಿ",
  },
  mr: {
    hero:    'प्रत्येक थेंबावर नियंत्रण.',
    hero2:   'प्रत्येक रुपयाचा मागोवा घ्या.',
    sub:     'भारतातील सर्वात संपूर्ण पेट्रोल पंप व्यवस्थापन प्लॅटफॉर्म — खरे नियंत्रण हवे असणाऱ्या मालकांसाठी.',
    cta:     'मोफत सुरू करा',
    demo:    'डेमो पहा',
    usp1_t:  '6 भारतीय भाषा',
    usp1_d:  'तुमचे कर्मचारी हिंदी, तमिळ, तेलुगू, कन्नड, मराठी किंवा इंग्रजीत काम करू शकतात. प्रत्येकाला त्यांच्या भाषेत अॅप.',
    usp2_t:  'WhatsApp अपडेट्स',
    usp2_d:  'WhatsApp वर तुमच्या पंपाला काहीही विचारा. दैनिक सारांश, सूचना आणि अहवाल — अॅपची गरज नाही.',
    usp3_t:  'क्रेडिट ग्राहक पोर्टल',
    usp3_d:  'तुमच्या कॉर्पोरेट ग्राहकांना स्वतःचा डॅशबोर्ड द्या. वाहननिहाय GST बिले, थकबाकी, संपूर्ण विवरण.',
    usp4_t:  'लाइव्ह डॅशबोर्ड',
    usp4_d:  'प्रत्येक विक्री घडताक्षणी पहा — तुमच्या फोनवरून, भारतात कुठूनही. रिअल-टाइम. विलंब नाही.',
    plans:   'सोपी किंमत',
    trial:   '30 दिवस मोफत चाचणी · क्रेडिट कार्ड नाही · कधीही रद्द करा',
    nav_features: "वैशिष्ट्ये",
    nav_pricing: "किंमत",
    nav_contact: "संपर्क",
    login: "लॉगिन",
    why_eyebrow: "पंपिनी का",
    why_title: "तुमच्या पेट्रोल पंपाच्या सर्व गरजा",
    why_sub: "भारतातील इतर प्रत्येक पेट्रोल पंप सॉफ्टवेअरपेक्षा आम्हाला वेगळे करणारी चार वैशिष्ट्ये",
    pricing_title: "सोपी किंमत",
    per_month: "/महिना",
    most_popular: "सर्वाधिक लोकप्रिय",
    get_started: "सुरू करा",
    stations_count: "दक्षिण भारतातील पेट्रोल पंप",
    whatsapp_ready: "WhatsApp तयार",
    cta_footer: "पंपिनीवर विश्वास ठेवणाऱ्या दक्षिण भारतातील पेट्रोल पंपांमध्ये सामील व्हा",
  },
};

const PLANS = [
  { name:'Starter', price:'999',  color:'#1A5F7A', features:['1 station','Up to 8 nozzles','5 users','Shifts & reconciliation','Daily reports'] },
  { name:'Pro',     price:'1,999',color:'#FF6B00', popular:true, features:['1 station','Unlimited nozzles','15 users','RFID tracking','Real-time dashboard','GST invoices','WhatsApp alerts'] },
  { name:'Business',price:'3,499',color:'#7c3aed', features:['Up to 3 stations','Everything in Pro','WhatsApp AI bot','Group dashboard','Corporate fleet portal'] },
];

export default function LandingPage() {
  const { i18n } = useTranslation();
  const [lang,    setLang]    = useState('en');
  const [scroll,  setScroll]  = useState(0);
  const [active,  setActive]  = useState(null);
  const t = COPY[lang] || COPY.en;

  // Sync with the app-wide i18next language (persisted in localStorage)
  useEffect(()=>{
    const current = (i18n.language || 'en').split('-')[0];
    if (COPY[current]) setLang(current);
  },[i18n.language]);

  const pickLang = (code) => {
    setLang(code);
    setActive(null);
    if (i18n && i18n.changeLanguage) i18n.changeLanguage(code);
  };

  useEffect(()=>{
    const onScroll = ()=>setScroll(window.scrollY);
    window.addEventListener('scroll',onScroll,{passive:true});
    return ()=>window.removeEventListener('scroll',onScroll);
  },[]);

  const USPS = [
    { icon:'🌐', color:'#FF6B00', bg:'#fff3e0', title:t.usp1_t, desc:t.usp1_d },
    { icon:'💬', color:'#25D366', bg:'#f0fdf4', title:t.usp2_t, desc:t.usp2_d },
    { icon:'🏢', color:'#1A5F7A', bg:'#f0f9ff', title:t.usp3_t, desc:t.usp3_d },
    { icon:'⚡', color:'#7c3aed', bg:'#faf5ff', title:t.usp4_t, desc:t.usp4_d },
  ];

  const NAV_LINKS = [
    { href:'#features', label:t.nav_features || 'Features' },
    { href:'#pricing',  label:t.nav_pricing  || 'Pricing' },
    { href:'#contact',  label:t.nav_contact  || 'Contact' },
  ];

  return (
    <div style={{fontFamily:"'DM Sans',system-ui,sans-serif",background:'#fff',color:'#0F1923',overflowX:'hidden'}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,700;0,9..40,800;0,9..40,900;1,9..40,400&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing:border-box; margin:0; padding:0; }
        html { scroll-behavior:smooth; }
        .fade-up { opacity:0; transform:translateY(24px); animation:fadeUp .6s forwards; }
        @keyframes fadeUp { to { opacity:1; transform:translateY(0); } }
        .usp-card:hover { transform:translateY(-4px); box-shadow:0 16px 48px rgba(0,0,0,.12) !important; }
        .usp-card { transition:transform .25s, box-shadow .25s; }
        .plan-card:hover { transform:translateY(-3px); }
        .plan-card { transition:transform .2s; }
        .lang-btn { transition:all .15s; }
        .lang-btn:hover { transform:scale(1.05); }
        .cta-primary:hover { transform:translateY(-2px); box-shadow:0 8px 24px rgba(255,107,0,.4) !important; }
        .cta-primary { transition:transform .2s, box-shadow .2s; }
        @media(max-width:768px){
          .hero-title { font-size:clamp(2rem,8vw,3rem) !important; }
          .usps-grid { grid-template-columns:1fr 1fr !important; }
          .plans-grid { grid-template-columns:1fr !important; }
          .nav-links { display:none !important; }
        }
        @media(max-width:480px){
          .usps-grid { grid-template-columns:1fr !important; }
        }
      `}</style>

      {/* ── NAV ── */}
      <nav style={{
        position:'fixed',top:0,left:0,right:0,zIndex:100,
        background:'rgba(255,255,255,.97)',
        backdropFilter:'blur(12px)',
        borderBottom:'1px solid rgba(0,0,0,.08)',
        boxShadow: scroll>40 ? '0 2px 12px rgba(0,0,0,.06)' : 'none',
        transition:'box-shadow .3s',padding:'0 2rem',height:64,
        display:'flex',alignItems:'center',justifyContent:'space-between',
      }}>
        <Image src="/pumpini-logo.png" alt="Pumpini" width={140} height={44} style={{objectFit:'contain'}}/>
        <div className="nav-links" style={{display:'flex',gap:'2rem',alignItems:'center'}}>
          {NAV_LINKS.map(l=>(
            <a key={l.href} href={l.href}
              style={{fontSize:14,fontWeight:500,color:'#333',textDecoration:'none',
                transition:'color .2s'}}
              onMouseEnter={e=>e.target.style.color='#FF6B00'}
              onMouseLeave={e=>e.target.style.color='#333'}>
              {l.label}
            </a>
          ))}
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          {/* Language selector */}
          <div style={{position:'relative'}}>
            <button onClick={()=>setActive(active==='lang'?null:'lang')}
              style={{display:'flex',alignItems:'center',gap:6,padding:'7px 12px',
                background:'rgba(255,255,255,.9)',border:'1px solid rgba(0,0,0,.12)',
                borderRadius:8,cursor:'pointer',fontSize:13,fontWeight:600}}>
              {LANGS.find(l=>l.code===lang)?.flag} {LANGS.find(l=>l.code===lang)?.label}
              <span style={{fontSize:10,opacity:.5}}>▼</span>
            </button>
            {active==='lang' && (
              <div style={{position:'absolute',top:'110%',right:0,background:'#fff',
                borderRadius:10,boxShadow:'0 8px 32px rgba(0,0,0,.15)',
                border:'1px solid rgba(0,0,0,.08)',overflow:'hidden',minWidth:160,zIndex:200}}>
                {LANGS.map(l=>(
                  <button key={l.code} onClick={()=>pickLang(l.code)}
                    className="lang-btn"
                    style={{display:'flex',alignItems:'center',gap:10,width:'100%',
                      padding:'10px 16px',background:lang===l.code?'#fff3e0':'transparent',
                      border:'none',cursor:'pointer',fontSize:14,
                      color:lang===l.code?'#FF6B00':'#333',fontWeight:lang===l.code?700:400,
                      textAlign:'left'}}>
                    <span>{l.flag}</span>{l.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Link href="/login"
            style={{padding:'8px 20px',background:'#FF6B00',color:'#fff',
              borderRadius:8,textDecoration:'none',fontWeight:700,fontSize:14,
              boxShadow:'0 2px 8px rgba(255,107,0,.3)'}}>
            {t.login || 'Login'}
          </Link>
        </div>
      </nav>

      {/* ── HERO ── */}
      <div style={{
        minHeight:'100vh',display:'flex',alignItems:'center',
        background:'linear-gradient(135deg,#0a1520 0%,#0F1923 50%,#0d2235 100%)',
        padding:'5rem 2rem 4rem',position:'relative',overflow:'hidden',
      }}>
        {/* Background decorative circles */}
        <div style={{position:'absolute',top:'-20%',right:'-10%',width:600,height:600,
          borderRadius:'50%',background:'radial-gradient(circle,rgba(255,107,0,.12) 0%,transparent 70%)',
          pointerEvents:'none'}}/>
        <div style={{position:'absolute',bottom:'-10%',left:'-5%',width:400,height:400,
          borderRadius:'50%',background:'radial-gradient(circle,rgba(26,95,122,.2) 0%,transparent 70%)',
          pointerEvents:'none'}}/>

        <div style={{maxWidth:1100,margin:'0 auto',width:'100%',
          display:'grid',gridTemplateColumns:'1fr 1fr',gap:'4rem',alignItems:'center'}}>

          {/* Left */}
          <div>
            <div className="fade-up" style={{animationDelay:'.1s',
              display:'inline-flex',alignItems:'center',gap:8,
              background:'rgba(255,107,0,.15)',border:'1px solid rgba(255,107,0,.3)',
              padding:'6px 16px',borderRadius:99,marginBottom:'1.5rem'}}>
              <span style={{width:6,height:6,borderRadius:'50%',background:'#FF6B00',
                animation:'pulse 2s infinite',display:'inline-block'}}/>
              <span style={{fontSize:13,color:'#FF6B00',fontWeight:600}}>
                Built for Indian petrol stations
              </span>
            </div>

            <h1 className="fade-up hero-title" style={{
              fontSize:'clamp(2.5rem,4vw,4rem)',fontWeight:900,lineHeight:1.05,
              color:'#fff',marginBottom:'0.5rem',animationDelay:'.2s',
              letterSpacing:'-.02em',
            }}>
              {t.hero}
            </h1>
            <h1 className="fade-up hero-title" style={{
              fontSize:'clamp(2.5rem,4vw,4rem)',fontWeight:900,lineHeight:1.05,
              color:'#FF6B00',marginBottom:'1.5rem',animationDelay:'.3s',
              letterSpacing:'-.02em',
            }}>
              {t.hero2}
            </h1>
            <p className="fade-up" style={{
              fontSize:18,color:'rgba(255,255,255,.65)',lineHeight:1.7,
              marginBottom:'2.5rem',animationDelay:'.4s',maxWidth:480,
            }}>
              {t.sub}
            </p>

            <div className="fade-up" style={{display:'flex',gap:12,flexWrap:'wrap',animationDelay:'.5s'}}>
              <Link href="/login"
                className="cta-primary"
                style={{display:'inline-flex',alignItems:'center',gap:8,
                  padding:'14px 28px',background:'#FF6B00',color:'#fff',
                  borderRadius:10,textDecoration:'none',fontWeight:700,fontSize:16,
                  boxShadow:'0 4px 20px rgba(255,107,0,.35)'}}>
                {t.cta} →
              </Link>
              <a href="https://wa.me/919999999999?text=I+want+a+demo+of+Pumpini"
                target="_blank" rel="noopener"
                style={{display:'inline-flex',alignItems:'center',gap:8,
                  padding:'14px 28px',background:'rgba(255,255,255,.08)',
                  color:'#fff',borderRadius:10,textDecoration:'none',fontWeight:600,
                  fontSize:16,border:'1px solid rgba(255,255,255,.2)'}}>
                📱 {t.demo}
              </a>
            </div>

            {/* Social proof */}
            <div className="fade-up" style={{marginTop:'2.5rem',animationDelay:'.6s',
              display:'flex',alignItems:'center',gap:'1.5rem'}}>
              <div style={{display:'flex'}}>
                {['🧑‍💼','👨‍💼','👩‍💼','🧑‍💼','👨‍💼'].map((e,i)=>(
                  <div key={i} style={{width:36,height:36,borderRadius:'50%',
                    background:`hsl(${200+i*20},60%,${40+i*5}%)`,
                    border:'2px solid #0F1923',marginLeft:i>0?-8:0,
                    display:'flex',alignItems:'center',justifyContent:'center',fontSize:16}}>
                    {e}
                  </div>
                ))}
              </div>
              <div style={{fontSize:13,color:'rgba(255,255,255,.5)'}}>
                <strong style={{color:'rgba(255,255,255,.9)'}}>500+</strong> {t.stations_count || 'petrol stations across South India'}
              </div>
            </div>
          </div>

          {/* Right — Feature preview cards */}
          <div className="fade-up" style={{animationDelay:'.4s',position:'relative'}}>
            {/* Main dashboard mockup */}
            <div style={{background:'rgba(255,255,255,.05)',borderRadius:16,
              border:'1px solid rgba(255,255,255,.1)',padding:'1.25rem',
              backdropFilter:'blur(10px)'}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:'1rem'}}>
                <div style={{width:8,height:8,borderRadius:'50%',background:'#ff5f57'}}/>
                <div style={{width:8,height:8,borderRadius:'50%',background:'#febc2e'}}/>
                <div style={{width:8,height:8,borderRadius:'50%',background:'#28c840'}}/>
                <div style={{flex:1,textAlign:'center',fontSize:11,color:'rgba(255,255,255,.3)'}}>
                  app.pumpini.in/dashboard
                </div>
              </div>
              {/* Mock stats */}
              <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:8,marginBottom:8}}>
                {[
                  ['Today\'s Sales','₹1,24,850','↑ 12%','#FF6B00'],
                  ['Total Litres','1,204 L','↑ 8%','#1A5F7A'],
                  ['Open Shifts','3','Active','#16a34a'],
                  ['Alerts','0','All clear ✓','#7c3aed'],
                ].map(([l,v,s,c])=>(
                  <div key={l} style={{background:'rgba(255,255,255,.06)',borderRadius:10,
                    padding:'0.75rem',border:'1px solid rgba(255,255,255,.08)'}}>
                    <div style={{fontSize:10,color:'rgba(255,255,255,.4)',marginBottom:4,textTransform:'uppercase',letterSpacing:'.05em'}}>{l}</div>
                    <div style={{fontSize:18,fontWeight:800,color:'#fff',fontFamily:'monospace'}}>{v}</div>
                    <div style={{fontSize:11,color:c,marginTop:2,fontWeight:600}}>{s}</div>
                  </div>
                ))}
              </div>
              {/* Mock tank levels */}
              <div style={{background:'rgba(255,255,255,.04)',borderRadius:10,padding:'0.75rem',
                border:'1px solid rgba(255,255,255,.06)'}}>
                <div style={{fontSize:10,color:'rgba(255,255,255,.4)',marginBottom:8,textTransform:'uppercase',letterSpacing:'.05em'}}>
                  Tank Levels
                </div>
                {[['Petrol','#3b82f6',75],['Diesel','#f59e0b',42],['Premium','#8b5cf6',88]].map(([n,c,p])=>(
                  <div key={n} style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                    <div style={{fontSize:12,color:'rgba(255,255,255,.6)',width:60}}>{n}</div>
                    <div style={{flex:1,height:6,background:'rgba(255,255,255,.1)',borderRadius:3}}>
                      <div style={{width:`${p}%`,height:'100%',background:c,borderRadius:3,
                        transition:'width 1s ease'}}/>
                    </div>
                    <div style={{fontSize:11,color:'rgba(255,255,255,.5)',width:30,textAlign:'right'}}>{p}%</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Floating WhatsApp badge */}
            <div style={{position:'absolute',top:-20,right:-20,
              background:'#25D366',borderRadius:12,padding:'10px 14px',
              boxShadow:'0 8px 24px rgba(37,211,102,.4)',
              fontSize:12,fontWeight:700,color:'#fff',
              display:'flex',alignItems:'center',gap:6,
              animation:'float 3s ease-in-out infinite'}}>
              <style>{`@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
              @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
              📱 {t.whatsapp_ready || 'WhatsApp Ready'}
            </div>

            {/* Floating language badge */}
            <div style={{position:'absolute',bottom:-16,left:-16,
              background:'#fff',borderRadius:12,padding:'10px 14px',
              boxShadow:'0 8px 24px rgba(0,0,0,.2)',
              fontSize:12,fontWeight:700,color:'#0F1923',
              display:'flex',alignItems:'center',gap:6}}>
              🌐 6 भाषाएँ · 6 மொழிகள் · 6 Languages
            </div>
          </div>
        </div>
      </div>

      {/* ── USPs ── */}
      <div id="features" style={{padding:'5rem 2rem',background:'#f8f7f5'}}>
        <div style={{maxWidth:1100,margin:'0 auto'}}>
          <div style={{textAlign:'center',marginBottom:'3rem'}}>
            <div style={{fontSize:13,fontWeight:700,color:'#FF6B00',
              textTransform:'uppercase',letterSpacing:'.1em',marginBottom:12}}>
              {t.why_eyebrow || 'WHY PUMPINI'}
            </div>
            <h2 style={{fontSize:'clamp(1.75rem,3vw,2.5rem)',fontWeight:900,
              letterSpacing:'-.02em',marginBottom:12}}>
              {t.why_title || 'Everything your petrol bunk needs'}
            </h2>
            <p style={{fontSize:16,color:'#666',maxWidth:500,margin:'0 auto'}}>
              {t.why_sub || 'Four features that set us apart from every other petrol station software in India'}
            </p>
          </div>

          <div className="usps-grid" style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:'1.5rem'}}>
            {USPS.map((u,i)=>(
              <div key={i} className="usp-card" style={{
                background:'#fff',borderRadius:16,padding:'2rem',
                boxShadow:'0 2px 16px rgba(0,0,0,.06)',
                border:'1px solid rgba(0,0,0,.06)',
                borderTop:`3px solid ${u.color}`,
              }}>
                <div style={{width:52,height:52,borderRadius:12,background:u.bg,
                  display:'flex',alignItems:'center',justifyContent:'center',
                  fontSize:24,marginBottom:'1rem'}}>
                  {u.icon}
                </div>
                <div style={{fontWeight:800,fontSize:18,marginBottom:8,
                  letterSpacing:'-.01em'}}>{u.title}</div>
                <p style={{fontSize:14,color:'#666',lineHeight:1.7}}>{u.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── COMPARISON ── */}
      <div style={{padding:'5rem 2rem',background:'#0F1923',color:'#fff'}}>
        <div style={{maxWidth:760,margin:'0 auto'}}>
          <div style={{textAlign:'center',marginBottom:'3rem'}}>
            <div style={{fontSize:13,fontWeight:700,color:'#FF6B00',
              textTransform:'uppercase',letterSpacing:'.1em',marginBottom:12}}>
              Pumpini vs Others
            </div>
            <h2 style={{fontSize:'clamp(1.75rem,3vw,2.25rem)',fontWeight:900}}>
              Why switch to Pumpini?
            </h2>
          </div>
          <div style={{borderRadius:14,overflow:'hidden',border:'1px solid rgba(255,255,255,.1)'}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 120px 120px',
              background:'rgba(255,255,255,.05)',padding:'12px 20px',
              fontSize:12,fontWeight:700,color:'rgba(255,255,255,.5)',
              textTransform:'uppercase',letterSpacing:'.06em'}}>
              <div>Feature</div>
              <div style={{textAlign:'center',color:'#FF6B00'}}>Pumpini</div>
              <div style={{textAlign:'center'}}>Others</div>
            </div>
            {[
              ['Real-time live dashboard'],
              ['6 Indian language support'],
              ['Blind drop cash reconciliation'],
              ['Vehicle-wise GST invoice'],
              ['Credit customer portal'],
              ['WhatsApp AI alerts'],
              ['Multi-station group view'],
              ['DC Challan capture'],
            ].map(([f],i)=>(
              <div key={f} style={{display:'grid',gridTemplateColumns:'1fr 120px 120px',
                padding:'14px 20px',borderTop:'1px solid rgba(255,255,255,.06)',
                background:i%2===0?'transparent':'rgba(255,255,255,.02)',
                alignItems:'center'}}>
                <div style={{fontSize:14,color:'rgba(255,255,255,.8)'}}>{f}</div>
                <div style={{textAlign:'center',fontSize:18}}>✅</div>
                <div style={{textAlign:'center',fontSize:18,opacity:.4}}>❌</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── PRICING ── */}
      <div id="pricing" style={{padding:'5rem 2rem',background:'#fff'}}>
        <div style={{maxWidth:1000,margin:'0 auto'}}>
          <div style={{textAlign:'center',marginBottom:'1rem'}}>
            <div style={{fontSize:13,fontWeight:700,color:'#FF6B00',
              textTransform:'uppercase',letterSpacing:'.1em',marginBottom:12}}>
              {t.nav_pricing || 'Pricing'}
            </div>
            <h2 style={{fontSize:'clamp(1.75rem,3vw,2.25rem)',fontWeight:900,
              marginBottom:8,letterSpacing:'-.02em'}}>{t.plans}</h2>
            <p style={{fontSize:14,color:'#888'}}>{t.trial}</p>
          </div>

          <div className="plans-grid" style={{display:'grid',
            gridTemplateColumns:'repeat(3,1fr)',gap:'1.25rem',marginTop:'2.5rem'}}>
            {PLANS.map(p=>(
              <div key={p.name} className="plan-card" style={{
                borderRadius:16,padding:'2rem',
                border:`2px solid ${p.popular?p.color:'#eee'}`,
                position:'relative',overflow:'hidden',
                boxShadow:p.popular?`0 8px 32px rgba(255,107,0,.15)`:'none',
                background:'#fff',
              }}>
                {p.popular && (
                  <div style={{position:'absolute',top:14,right:-28,
                    background:'#FF6B00',color:'#fff',fontSize:10,fontWeight:800,
                    padding:'4px 40px',transform:'rotate(45deg)',
                    letterSpacing:'.08em'}}>
                    {(t.most_popular || 'Most Popular').toUpperCase()}
                  </div>
                )}
                <div style={{fontWeight:800,fontSize:18,color:p.color,marginBottom:4}}>{p.name}</div>
                <div style={{marginBottom:'1.5rem'}}>
                  <span style={{fontSize:40,fontWeight:900,letterSpacing:'-.02em'}}>₹{p.price}</span>
                  <span style={{fontSize:13,color:'#888'}}>{t.per_month || '/month'}</span>
                </div>
                {p.features.map(f=>(
                  <div key={f} style={{display:'flex',gap:8,marginBottom:8,
                    fontSize:13,color:'#444',alignItems:'flex-start'}}>
                    <span style={{color:'#16a34a',fontWeight:700,flexShrink:0}}>✓</span>{f}
                  </div>
                ))}
                <Link href="/login" style={{display:'block',textAlign:'center',
                  marginTop:'1.5rem',padding:'12px',background:p.color,
                  color:'#fff',borderRadius:8,textDecoration:'none',
                  fontWeight:700,fontSize:14}}>
                  {t.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── FOOTER CTA ── */}
      <div style={{background:'linear-gradient(135deg,#FF6B00,#c4520a)',
        padding:'4rem 2rem',textAlign:'center',color:'#fff'}}>
        <Image src="/pumpini-logo.png" alt="Pumpini" width={160} height={50}
          style={{objectFit:'contain',marginBottom:'1.5rem',filter:'brightness(0) invert(1)'}}/>
        <h2 style={{fontSize:'clamp(1.5rem,3vw,2.25rem)',fontWeight:900,
          marginBottom:'0.75rem',letterSpacing:'-.02em'}}>
          {t.cta || 'Start Free Trial'}
        </h2>
        <p style={{fontSize:16,opacity:.85,marginBottom:'2rem'}}>
          {t.cta_footer || 'Join petrol stations across South India who trust Pumpini'}
        </p>
        <div style={{display:'flex',gap:12,justifyContent:'center',flexWrap:'wrap'}}>
          <Link href="/login" style={{padding:'14px 32px',background:'#fff',
            color:'#FF6B00',borderRadius:10,textDecoration:'none',fontWeight:800,fontSize:16}}>
            {t.cta || 'Start Free Trial'}
          </Link>
          <a href="https://wa.me/919999999999"
            target="_blank" rel="noopener"
            style={{padding:'14px 32px',background:'#25D366',color:'#fff',
              borderRadius:10,textDecoration:'none',fontWeight:700,fontSize:16,
              display:'flex',alignItems:'center',gap:8}}>
            📱 WhatsApp Us
          </a>
        </div>
      </div>

      {/* ── FOOTER ── */}
      <div id="contact" style={{background:'#0a1118',color:'rgba(255,255,255,.4)',
        padding:'1.5rem 2rem',textAlign:'center',fontSize:12}}>
        © 2026 Pumpini · Madurai, Tamil Nadu · Built for Indian petrol stations
      </div>

      {/* Click outside to close language dropdown */}
      {active && (
        <div style={{position:'fixed',inset:0,zIndex:99}}
          onClick={()=>setActive(null)}/>
      )}
    </div>
  );
}

