'use client';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Image from 'next/image';
import Link from 'next/link';
import { Zap, Mic, Send } from 'lucide-react';

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
    sub:     'India\'s most intelligent petrol station management platform — built for owners who want real control, in their own language.',
    cta:     'Start Free Trial →',
    demo:    '📱 WhatsApp Demo',
    usp1_t:  '🎙 Voice POS Entry',
    usp1_d:  'Attendants speak transactions in Telugu, Tamil, Hindi or any Indian language. "50 litres petrol cash" — done. No typing needed.',
    usp2_t:  '🌐 6 Indian Languages',
    usp2_d:  'Every screen, every button, every alert — in Hindi, Tamil, Telugu, Kannada, Marathi or English. Your team works in the language they think in.',
    usp3_t:  '🔒 Blind-Drop Cash Control',
    usp3_d:  'Attendants drop collections without seeing the expected total — so they can\'t skim or short-change. Every customer gets correct change back, every time. Honest counters, happier customers, zero cash leakage.',
    usp4_t:  '⚡ Live Dashboard',
    usp4_d:  'Watch every sale as it happens — from your phone, anywhere in India. Real-time nozzle activity, shift status, tank levels. No delays.',
    usp5_t:  '🏢 Credit & Corporate Portal',
    usp5_d:  'Vehicle-wise GST invoices, outstanding tracking, credit limits. Your corporate clients get their own dashboard with full statement history.',
    usp6_t:  '🛒 Lubes & Products',
    usp6_d:  'Sell engine oils, lubricants and accessories with barcode scanning, GST invoices (LUB- series), and integrated stock management.',
    feat_title: 'Everything your petrol bunk needs',
    feat_sub:   'One platform. Every transaction. Total control.',
    compare_title: 'Why switch to Pumpini?',
    pricing_title: 'Simple pricing. No surprises.',
    pricing_sub:   '15-day free trial · No credit card · Cancel anytime',
    footer_cta: 'Start your free trial today',
    footer_sub: 'Join petrol stations across India who trust Pumpini',
  },
  hi: {
    hero:    'हर बूंद पर नियंत्रण।',
    hero2:   'हर रुपया ट्रैक करें।',
    sub:     'भारत का सबसे स्मार्ट पेट्रोल पंप मैनेजमेंट सिस्टम — आपकी भाषा में।',
    cta:     'मुफ्त ट्रायल शुरू करें →',
    demo:    '📱 WhatsApp डेमो',
    usp1_t:  '🎙 आवाज़ से POS एंट्री',
    usp1_d:  'अटेंडेंट हिंदी, तेलुगु या किसी भी भाषा में बोलकर एंट्री करें। "50 लीटर पेट्रोल कैश" — बस इतना काफी।',
    usp2_t:  '🌐 6 भारतीय भाषाएँ',
    usp2_d:  'हर स्क्रीन, हर बटन हिंदी, तमिल, तेलुगु, कन्नड़, मराठी या अंग्रेजी में।',
    usp3_t:  '🔒 ब्लाइंड-ड्रॉप कैश कंट्रोल',
    usp3_d:  'अटेंडेंट को पता नहीं होता कि कितना कैश जमा होना है — इसलिए वह पैसे नहीं चुरा सकता या कम छुट्टे नहीं दे सकता। हर ग्राहक को सही छुट्टे मिलते हैं। ईमानदार स्टाफ, खुश ग्राहक, ज़ीरो लीकेज।',
    usp4_t:  '⚡ लाइव डैशबोर्ड',
    usp4_d:  'हर बिक्री रियल-टाइम में देखें — अपने फोन से, कहीं से भी।',
    usp5_t:  '🏢 क्रेडिट कस्टमर पोर्टल',
    usp5_d:  'GST इनवॉइस, बकाया ट्रैकिंग, क्रेडिट लिमिट — सब एक जगह।',
    usp6_t:  '🛒 लुब्रिकेंट्स और प्रोडक्ट्स',
    usp6_d:  'बारकोड स्कैन से बिक्री, GST इनवॉइस और स्टॉक मैनेजमेंट।',
    feat_title: 'पेट्रोल पंप के लिए सब कुछ',
    feat_sub:   'एक प्लेटफॉर्म। हर ट्रांजेक्शन। पूरा कंट्रोल।',
    compare_title: 'Pumpini क्यों चुनें?',
    pricing_title: 'सरल मूल्य निर्धारण।',
    pricing_sub:   '15 दिन मुफ्त · कोई क्रेडिट कार्ड नहीं',
    footer_cta: 'आज ही मुफ्त ट्रायल शुरू करें',
    footer_sub: 'भारत भर के पेट्रोल पंप मालिक Pumpini पर भरोसा करते हैं',
  },
  ta: {
    hero:    'ஒவ்வொரு துளியையும் கட்டுப்படுத்துங்கள்.',
    hero2:   'ஒவ்வொரு ரூபாயையும் கண்காணியுங்கள்.',
    sub:     'இந்தியாவின் மிகவும் ஸ்மார்ட் பெட்ரோல் நிலைய மேலாண்மை தளம் — உங்கள் மொழியில்.',
    cta:     'இலவச சோதனை தொடங்கு →',
    demo:    '📱 WhatsApp டெமோ',
    usp1_t:  '🎙 குரல் POS உள்ளீடு',
    usp1_d:  'தமிழ் அல்லது எந்த மொழியிலும் பேசி பரிவர்த்தனை பதிவு செய்யுங்கள்.',
    usp2_t:  '🌐 6 இந்திய மொழிகள்',
    usp2_d:  'தமிழ், தெலுங்கு, கன்னடம், மராத்தி, இந்தி அல்லது ஆங்கிலத்தில் முழு ஆதரவு.',
    usp3_t:  '🔒 பிளைண்ட்-டிராப் பணக் கட்டுப்பாடு',
    usp3_d:  'எவ்வளவு பணம் வரவேண்டும் என்று தெரியாமலேயே ஊழியர் பணத்தை செலுத்துகிறார் — எனவே திருட்டோ குறைவான சில்லறையோ முடியாது. ஒவ்வொரு வாடிக்கையாளரும் சரியான சில்லறை பெறுகிறார். நேர்மையான ஊழியர்கள், மகிழ்ச்சியான வாடிக்கையாளர்கள், பணக் கசிவு இல்லை.',
    usp4_t:  '⚡ நேரடி டாஷ்போர்டு',
    usp4_d:  'உங்கள் தொலைபேசியில் நேரடியாக விற்பனையை கண்காணியுங்கள்.',
    usp5_t:  '🏢 கடன் வாடிக்கையாளர் போர்டல்',
    usp5_d:  'GST இன்வாய்ஸ், நிலுவைத் தொகை கண்காணிப்பு, கடன் வரம்பு.',
    usp6_t:  '🛒 லூப்ரிகண்ட்கள் & பொருட்கள்',
    usp6_d:  'பார்கோட் ஸ்கேன், GST இன்வாய்ஸ் மற்றும் ஸ்டாக் மேலாண்மை.',
    feat_title: 'உங்கள் நிலையத்திற்கு தேவையான அனைத்தும்',
    feat_sub:   'ஒரு தளம். அனைத்து பரிவர்த்தனைகள். முழு கட்டுப்பாடு.',
    compare_title: 'Pumpini ஏன் சிறந்தது?',
    pricing_title: 'எளிமையான விலை நிர்ணயம்.',
    pricing_sub:   '15 நாள் இலவசம் · கிரெடிட் கார்டு தேவையில்லை',
    footer_cta: 'இன்றே இலவச சோதனை தொடங்குங்கள்',
    footer_sub: 'இந்தியா முழுவதும் பெட்ரோல் நிலையங்கள் Pumpini-ஐ நம்புகின்றன',
  },
  te: {
    hero:    'ప్రతి చుక్కను నియంత్రించండి.',
    hero2:   'ప్రతి రూపాయిని ట్రాక్ చేయండి.',
    sub:     'భారతదేశంలో అత్యంత తెలివైన పెట్రోల్ బంక్ నిర్వహణ వేదిక — మీ భాషలో.',
    cta:     'ఉచిత ట్రయల్ ప్రారంభించండి →',
    demo:    '📱 WhatsApp డెమో',
    usp1_t:  '🎙 వాయిస్ POS ఎంట్రీ',
    usp1_d:  '"50 లీటర్లు పెట్రోల్ నగదు" — తెలుగులో చెప్పండి, ఆటోమేటిగ్గా రికార్డ్ అవుతుంది.',
    usp2_t:  '🌐 6 భారతీయ భాషలు',
    usp2_d:  'తెలుగు, తమిళం, హిందీ, కన్నడ, మరాఠీ లేదా ఇంగ్లీష్‌లో మొత్తం సపోర్ట్.',
    usp3_t:  '🔒 బ్లైండ్-డ్రాప్ క్యాష్ కంట్రోల్',
    usp3_d:  'ఎంత నగదు రావాలో తెలియకుండానే అటెండర్ నగదును జమ చేస్తాడు — కాబట్టి దొంగతనం చేయలేడు లేదా తక్కువ చిల్లర ఇవ్వలేడు. ప్రతి కస్టమర్‌కు సరైన చిల్లర తిరిగి వస్తుంది. నిజాయితీ సిబ్బంది, సంతోషంగా ఉన్న కస్టమర్లు, జీరో లీకేజ్.',
    usp4_t:  '⚡ లైవ్ డాష్‌బోర్డ్',
    usp4_d:  'మీ ఫోన్‌లో రియల్-టైమ్‌లో అమ్మకాలు చూడండి — ఎక్కడి నుండైనా.',
    usp5_t:  '🏢 క్రెడిట్ కస్టమర్ పోర్టల్',
    usp5_d:  'GST ఇన్వాయిస్‌లు, బాకీ ట్రాకింగ్, క్రెడిట్ లిమిట్ — అన్నీ ఒకే చోట.',
    usp6_t:  '🛒 లూబ్రికెంట్లు & ప్రొడక్ట్స్',
    usp6_d:  'బార్‌కోడ్ స్కాన్, GST ఇన్వాయిస్ మరియు స్టాక్ మేనేజ్‌మెంట్.',
    feat_title: 'మీ పెట్రోల్ బంక్‌కు అవసరమైన అన్నీ',
    feat_sub:   'ఒక్క వేదిక. అన్ని లావాదేవీలు. పూర్తి నియంత్రణ.',
    compare_title: 'Pumpini ఎందుకు మెరుగైనది?',
    pricing_title: 'సరళమైన ధర నిర్ణయం.',
    pricing_sub:   '15 రోజులు ఉచితం · క్రెడిట్ కార్డు అవసరం లేదు',
    footer_cta: 'ఈరోజే ఉచిత ట్రయల్ ప్రారంభించండి',
    footer_sub: 'భారతదేశం అంతటా పెట్రోల్ బంకులు Pumpini నమ్ముతున్నాయి',
  },
  kn: {
    hero:    'ಪ್ರತಿ ಹನಿಯನ್ನು ನಿಯಂತ್ರಿಸಿ.',
    hero2:   'ಪ್ರತಿ ರೂಪಾಯಿಯನ್ನು ಟ್ರ್ಯಾಕ್ ಮಾಡಿ.',
    sub:     'ಭಾರತದ ಅತ್ಯಂತ ಬುದ್ಧಿವಂತ ಪೆಟ್ರೋಲ್ ಬಂಕ್ ನಿರ್ವಹಣಾ ವೇದಿಕೆ — ನಿಮ್ಮ ಭಾಷೆಯಲ್ಲಿ.',
    cta:     'ಉಚಿತ ಟ್ರಯಲ್ ಪ್ರಾರಂಭಿಸಿ →',
    demo:    '📱 WhatsApp ಡೆಮೋ',
    usp1_t:  '🎙 ವಾಯ್ಸ್ POS ಎಂಟ್ರಿ',
    usp1_d:  'ಕನ್ನಡ ಅಥವಾ ಯಾವುದೇ ಭಾಷೆಯಲ್ಲಿ ಮಾತನಾಡಿ ವ್ಯವಹಾರ ದಾಖಲಿಸಿ.',
    usp2_t:  '🌐 6 ಭಾರತೀಯ ಭಾಷೆಗಳು',
    usp2_d:  'ಕನ್ನಡ, ತೆಲುಗು, ತಮಿಳು, ಹಿಂದಿ, ಮರಾಠಿ ಅಥವಾ ಇಂಗ್ಲೀಷ್‌ನಲ್ಲಿ ಸಂಪೂರ್ಣ ಬೆಂಬಲ.',
    usp3_t:  '🔒 ಬ್ಲೈಂಡ್-ಡ್ರಾಪ್ ನಗದು ನಿಯಂತ್ರಣ',
    usp3_d:  'ಎಷ್ಟು ನಗದು ಬರಬೇಕು ಎಂದು ತಿಳಿಯದೆಯೇ ಸಿಬ್ಬಂದಿ ನಗದು ಜಮೆ ಮಾಡುತ್ತಾರೆ — ಆದ್ದರಿಂದ ಕಳ್ಳತನ ಅಥವಾ ಕಡಿಮೆ ಚಿಲ್ಲರೆ ಕೊಡಲು ಸಾಧ್ಯವಿಲ್ಲ. ಪ್ರತಿ ಗ್ರಾಹಕರಿಗೆ ಸರಿಯಾದ ಚಿಲ್ಲರೆ ಸಿಗುತ್ತದೆ. ಪ್ರಾಮಾಣಿಕ ಸಿಬ್ಬಂದಿ, ಸಂತೋಷದ ಗ್ರಾಹಕರು, ಶೂನ್ಯ ಸೋರಿಕೆ.',
    usp4_t:  '⚡ ಲೈವ್ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್',
    usp4_d:  'ರಿಯಲ್-ಟೈಮ್‌ನಲ್ಲಿ ಮಾರಾಟ ನೋಡಿ — ನಿಮ್ಮ ಫೋನ್‌ನಿಂದ.',
    usp5_t:  '🏢 ಕ್ರೆಡಿಟ್ ಗ್ರಾಹಕ ಪೋರ್ಟಲ್',
    usp5_d:  'GST ಇನ್‌ವಾಯ್ಸ್, ಬಾಕಿ ಟ್ರ್ಯಾಕಿಂಗ್, ಕ್ರೆಡಿಟ್ ಮಿತಿ.',
    usp6_t:  '🛒 ಲೂಬ್ರಿಕೆಂಟ್‌ಗಳು & ಉತ್ಪನ್ನಗಳು',
    usp6_d:  'ಬಾರ್‌ಕೋಡ್ ಸ್ಕ್ಯಾನ್, GST ಇನ್‌ವಾಯ್ಸ್ ಮತ್ತು ಸ್ಟಾಕ್ ನಿರ್ವಹಣೆ.',
    feat_title: 'ನಿಮ್ಮ ಪೆಟ್ರೋಲ್ ಬಂಕ್‌ಗೆ ಬೇಕಾದ ಎಲ್ಲವೂ',
    feat_sub:   'ಒಂದು ವೇದಿಕೆ. ಎಲ್ಲಾ ವ್ಯವಹಾರಗಳು. ಸಂಪೂರ್ಣ ನಿಯಂತ್ರಣ.',
    compare_title: 'Pumpini ಏಕೆ ಉತ್ತಮ?',
    pricing_title: 'ಸರಳ ಬೆಲೆ ನಿರ್ಧಾರ.',
    pricing_sub:   '15 ದಿನ ಉಚಿತ · ಕ್ರೆಡಿಟ್ ಕಾರ್ಡ್ ಅಗತ್ಯವಿಲ್ಲ',
    footer_cta: 'ಇಂದೇ ಉಚಿತ ಟ್ರಯಲ್ ಪ್ರಾರಂಭಿಸಿ',
    footer_sub: 'ಭಾರತದಾದ್ಯಂತ ಪೆಟ್ರೋಲ್ ಬಂಕ್‌ಗಳು Pumpini ನಂಬುತ್ತವೆ',
  },
  mr: {
    hero:    'प्रत्येक थेंब नियंत्रित करा.',
    hero2:   'प्रत्येक रुपया ट्रॅक करा.',
    sub:     'भारतातील सर्वात हुशार पेट्रोल पंप व्यवस्थापन प्लॅटफॉर्म — तुमच्या भाषेत.',
    cta:     'मोफत चाचणी सुरू करा →',
    demo:    '📱 WhatsApp डेमो',
    usp1_t:  '🎙 आवाज POS एंट्री',
    usp1_d:  'मराठी किंवा कोणत्याही भाषेत बोलून व्यवहार नोंदवा.',
    usp2_t:  '🌐 6 भारतीय भाषा',
    usp2_d:  'मराठी, हिंदी, तमिळ, तेलुगू, कन्नड किंवा इंग्रजीत संपूर्ण समर्थन.',
    usp3_t:  '🔒 ब्लाइंड-ड्रॉप कॅश कंट्रोल',
    usp3_d:  'किती रोख जमा व्हायची हे न कळताच कर्मचारी रोख जमा करतो — त्यामुळे चोरी किंवा कमी सुटे देणे शक्य नाही. प्रत्येक ग्राहकाला योग्य सुटे परत मिळतात. प्रामाणिक कर्मचारी, आनंदी ग्राहक, शून्य गळती.',
    usp4_t:  '⚡ थेट डॅशबोर्ड',
    usp4_d:  'रिअल-टाइममध्ये विक्री पहा — तुमच्या फोनवरून.',
    usp5_t:  '🏢 क्रेडिट ग्राहक पोर्टल',
    usp5_d:  'GST इनव्हॉइस, थकबाकी ट्रॅकिंग, क्रेडिट मर्यादा.',
    usp6_t:  '🛒 लुब्रिकेंट्स आणि उत्पादने',
    usp6_d:  'बारकोड स्कॅन, GST इनव्हॉइस आणि स्टॉक व्यवस्थापन.',
    feat_title: 'तुमच्या पेट्रोल पंपासाठी सर्व काही',
    feat_sub:   'एक प्लॅटफॉर्म. सर्व व्यवहार. संपूर्ण नियंत्रण.',
    compare_title: 'Pumpini का निवडावे?',
    pricing_title: 'सोपे मूल्य निर्धारण.',
    pricing_sub:   '15 दिवस मोफत · क्रेडिट कार्ड नाही',
    footer_cta: 'आजच मोफत चाचणी सुरू करा',
    footer_sub: 'भारतभरातील पेट्रोल पंप Pumpini वर विश्वास ठेवतात',
  },
};

const FEATURES = [
  { icon:'🎙', key:'usp1' },
  { icon:'🌐', key:'usp2' },
  { icon:'🔒', key:'usp3' },
  { icon:'⚡', key:'usp4' },
  { icon:'🏢', key:'usp5' },
  { icon:'🛒', key:'usp6' },
];

// Honest comparison vs typical Indian pump software.
// Values: 'yes' | 'partial' | 'no'  — we concede the basics so the
// differentiators are believable.
const COMPARE = [
  ['Billing & GST invoices',            'yes', 'yes'],
  ['Shift & cash reconciliation',       'yes', 'yes'],
  ['Tank stock & nozzle readings',      'yes', 'yes'],
  ['Credit / corporate customers',      'yes', 'yes'],
  ['Cloud + mobile app',                'yes', 'partial'],
  ['WhatsApp alerts',                   'yes', 'partial'],
  ['Voice POS in Indian languages',     'yes', 'no'],
  ['Full app in 6 Indian languages',    'yes', 'no'],
  ['GPS geo-fencing security',          'yes', 'no'],
  ['Blind-drop cash control',           'yes', 'no'],
  ['AI assistant — ask your data',      'yes', 'no'],
  ['Real-time live dashboard',          'yes', 'partial'],
];

const CMP_MARK = { yes:'✅', partial:'⚠️', no:'❌' };

const PLANS = [
  {
    name: 'PRO',
    price: '₹999',
    period: '/month',
    color: '#1A5F7A',
    popular: false,
    features: [
      '1 petrol station',
      'Unlimited nozzles & tanks',
      'Up to 15 users',
      'Voice POS entry',
      '6 language support',
      'Shifts & reconciliation',
      'GST invoices',
      'Credit customers',
      'Lubes & products',
      'Real-time dashboard',
      'Geo-fencing security',
      'WhatsApp alerts',
    ],
  },
  {
    name: 'ENTERPRISE',
    price: '₹1,999',
    period: '/month',
    color: '#FF6B00',
    popular: true,
    features: [
      'Up to 5 petrol stations',
      'Everything in PRO',
      'Group dashboard',
      'Multi-station reports',
      'Corporate fleet portal',
      'Priority support',
      'Custom invoice prefix',
      'Advanced analytics',
    ],
  },
];

const leadInp = {
  width:'100%',padding:'11px 13px',border:'1.5px solid #e5e7eb',borderRadius:10,
  fontSize:14,outline:'none',boxSizing:'border-box',fontFamily:'inherit',color:'#1a1a1a',background:'#fff',
};

export default function LandingPage() {
  const [lang,    setLang]    = useState('en');
  const [langOpen,setLangOpen] = useState(false);
  const [scrolled,setScrolled] = useState(false);
  const c = COPY[lang] || COPY.en;

  // Contact / lead form
  const [lead, setLead] = useState({ name:'', phone:'', station_name:'', city:'', message:'', company:'' });
  const [leadState, setLeadState] = useState('idle'); // idle | sending | done | error
  const setL = (k,v) => setLead(p => ({ ...p, [k]: v }));

  const submitLead = async (e) => {
    e.preventDefault();
    if (!lead.name.trim() || !lead.phone.trim()) return;
    setLeadState('sending');
    try {
      const r = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lead),
      });
      if (!r.ok) throw new Error('failed');
      setLeadState('done');
    } catch {
      setLeadState('error');
    }
  };

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const changeLang = (code) => {
    setLang(code);
    setLangOpen(false);
    if (typeof window !== 'undefined') {
      localStorage.setItem('i18nextLng', code);
    }
  };

  return (
    <div style={{fontFamily:'DM Sans,system-ui,sans-serif',color:'#1a1a1a',overflowX:'hidden'}}>

      {/* Responsive grid helpers — inline grid-template-columns can't be
          overridden by a media query, so two-column sections use these classes. */}
      <style>{`
        .pmp-2col  { grid-template-columns: 1fr 1fr; }
        .pmp-cmp   { grid-template-columns: 1fr 90px 90px; }
        .pmp-form2 { grid-template-columns: 1fr 1fr; }
        @media (max-width: 860px) {
          .pmp-2col { grid-template-columns: 1fr; gap: 2.25rem !important; }
        }
        @media (max-width: 600px) {
          .pmp-cmp { grid-template-columns: 1fr 54px 54px; }
        }
        @media (max-width: 460px) {
          .pmp-form2 { grid-template-columns: 1fr; }
        }
      `}</style>

      {/* ── Navbar ── */}
      <nav style={{
        position:'fixed',top:0,left:0,right:0,zIndex:100,
        background:'#fff',
        borderBottom:'1px solid rgba(0,0,0,.08)',
        boxShadow: scrolled ? '0 2px 12px rgba(0,0,0,.08)' : 'none',
        transition:'box-shadow .3s',padding:'0 5%',
        display:'flex',alignItems:'center',justifyContent:'space-between',height:64,
      }}>
        <Link href="/" style={{display:'flex',alignItems:'center'}} aria-label="Pumpini home">
          <Image src="/pumpini-logo.png" alt="Pumpini — control every drop, track every rupee"
            width={150} height={46} priority style={{objectFit:'contain',display:'block'}}/>
        </Link>

        <div style={{display:'flex',alignItems:'center',gap:'2rem'}}>
          <a href="#features" style={{textDecoration:'none',color:'#555',fontSize:14,fontWeight:500}}>Features</a>
          <a href="#pricing"  style={{textDecoration:'none',color:'#555',fontSize:14,fontWeight:500}}>Pricing</a>
          <a href="#contact"  style={{textDecoration:'none',color:'#555',fontSize:14,fontWeight:500}}>Contact</a>

          {/* Language switcher */}
          <div style={{position:'relative'}}>
            <button onClick={()=>setLangOpen(p=>!p)}
              style={{display:'flex',alignItems:'center',gap:6,padding:'6px 12px',
                background:'rgba(0,0,0,.06)',border:'none',borderRadius:8,cursor:'pointer',fontSize:13,fontWeight:500}}>
              {LANGS.find(l=>l.code===lang)?.flag} {LANGS.find(l=>l.code===lang)?.label} ▾
            </button>
            {langOpen && (
              <div style={{position:'absolute',right:0,top:'calc(100% + 6px)',background:'#fff',
                borderRadius:10,boxShadow:'0 8px 30px rgba(0,0,0,.15)',padding:'0.5rem',
                minWidth:160,zIndex:200}}>
                {LANGS.map(l=>(
                  <button key={l.code} onClick={()=>changeLang(l.code)}
                    style={{display:'flex',alignItems:'center',gap:8,width:'100%',padding:'8px 12px',
                      background:lang===l.code?'#fff7ed':'transparent',border:'none',borderRadius:7,
                      cursor:'pointer',fontSize:13,fontWeight:lang===l.code?700:400,
                      color:lang===l.code?'#FF6B00':'#333',textAlign:'left'}}>
                    {l.flag} {l.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <Link href="/login" style={{padding:'8px 20px',background:'#FF6B00',color:'#fff',
            borderRadius:8,textDecoration:'none',fontWeight:700,fontSize:14}}>
            Login
          </Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section style={{
        minHeight:'100dvh',
        background:'linear-gradient(135deg, #0F1923 0%, #1A2E3B 50%, #0F1923 100%)',
        display:'flex',alignItems:'center',justifyContent:'center',
        padding:'90px 5% 60px',position:'relative',overflow:'hidden',
      }}>
        {/* Background decoration */}
        <div style={{position:'absolute',inset:0,opacity:.04,backgroundImage:
          'radial-gradient(circle at 20% 80%, #FF6B00 0%, transparent 50%), radial-gradient(circle at 80% 20%, #1A5F7A 0%, transparent 50%)'}}/>

        <div className="pmp-hero" style={{
          maxWidth:1150,width:'100%',display:'grid',gap:'3rem',
          alignItems:'center',position:'relative',zIndex:1,
        }}>
          {/* ── LEFT: copy ── */}
          <div className="pmp-hero-text">
            {/* Badge */}
            <div style={{display:'inline-flex',alignItems:'center',gap:8,background:'rgba(255,107,0,.15)',
              border:'1px solid rgba(255,107,0,.3)',borderRadius:99,padding:'6px 16px',
              marginBottom:'1.5rem',fontSize:13,fontWeight:600,color:'#FF6B00'}}>
              ⛽ Built for Indian Petrol Stations
            </div>

            {/* Headline */}
            <h1 style={{fontSize:'clamp(2.4rem,5vw,4rem)',fontWeight:900,lineHeight:1.1,
              color:'#fff',marginBottom:'0.5rem',letterSpacing:'-.03em'}}>
              {c.hero}
            </h1>
            <h1 style={{fontSize:'clamp(2.4rem,5vw,4rem)',fontWeight:900,lineHeight:1.1,
              background:'linear-gradient(90deg,#FF6B00,#f97316)',
              WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',
              marginBottom:'1.5rem',letterSpacing:'-.03em'}}>
              {c.hero2}
            </h1>

            <p style={{fontSize:'clamp(1rem,1.6vw,1.15rem)',color:'rgba(255,255,255,.7)',
              maxWidth:520,lineHeight:1.6,marginBottom:'2rem'}}>
              {c.sub}
            </p>

            {/* Trust badges */}
            <div className="pmp-hero-badges" style={{display:'flex',gap:'1.5rem',flexWrap:'wrap',
              fontSize:13,color:'rgba(255,255,255,.5)',fontWeight:500}}>
              <span>🎙 Voice POS</span>
              <span>🌐 6 Languages</span>
              <span>📍 Geo-Fencing</span>
              <span>🛒 Lubes & Products</span>
            </div>
          </div>

          {/* ── RIGHT: live AI chat mockup ── */}
          <div style={{position:'relative',display:'flex',justifyContent:'center'}}>
            {/* glow */}
            <div style={{position:'absolute',inset:'-10% 5%',background:
              'radial-gradient(circle, rgba(255,107,0,.35) 0%, transparent 70%)',
              filter:'blur(40px)',zIndex:0}}/>

            <div style={{
              position:'relative',zIndex:1,width:'100%',maxWidth:380,
              background:'#fff',borderRadius:18,overflow:'hidden',
              boxShadow:'0 24px 70px rgba(0,0,0,.45)',
              border:'1px solid rgba(255,255,255,.12)',
            }}>
              {/* Header */}
              <div style={{display:'flex',alignItems:'center',gap:10,padding:'12px 16px',background:'#FF6B00'}}>
                <div style={{width:32,height:32,background:'rgba(255,255,255,.2)',borderRadius:8,
                  display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                  <Zap size={16} color="#fff" fill="#fff"/>
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:14,fontWeight:800,color:'#fff'}}>AI Assistant</div>
                  <div style={{fontSize:11,color:'rgba(255,255,255,.8)'}}>Live station data · EN</div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:5,fontSize:11,
                  color:'rgba(255,255,255,.85)',fontWeight:600}}>
                  <span style={{width:7,height:7,borderRadius:'50%',background:'#28c840',
                    boxShadow:'0 0 0 3px rgba(40,200,64,.3)'}}/>
                  Live
                </div>
              </div>

              {/* Messages */}
              <div style={{padding:'16px 14px',display:'flex',flexDirection:'column',gap:12,
                background:'#f8fafc',minHeight:230}}>
                {/* User question */}
                <div style={{display:'flex',justifyContent:'flex-end'}}>
                  <div style={{maxWidth:'80%',padding:'9px 13px',borderRadius:12,borderBottomRightRadius:3,
                    background:'#FF6B00',color:'#fff',fontSize:13.5,fontWeight:500,lineHeight:1.5}}>
                    Today&apos;s total sales?
                  </div>
                </div>

                {/* AI answer */}
                <div style={{display:'flex',alignItems:'flex-start',gap:7}}>
                  <div style={{width:24,height:24,background:'#FF6B00',borderRadius:7,
                    display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginTop:2}}>
                    <Zap size={12} color="#fff" fill="#fff"/>
                  </div>
                  <div style={{maxWidth:'82%',padding:'10px 13px',borderRadius:12,borderBottomLeftRadius:3,
                    background:'#fff',color:'#1a1a1a',fontSize:13,lineHeight:1.6,
                    border:'1px solid #eef1f4',boxShadow:'0 1px 2px rgba(0,0,0,.04)'}}>
                    Today&apos;s total is <b>₹1,24,850</b> across <b>312 fills</b>. 🚀
                    <div style={{marginTop:8,display:'flex',flexDirection:'column',gap:3,
                      fontSize:12.5,color:'#475569'}}>
                      <span>• Cash <b style={{color:'#16a34a'}}>₹68,400</b></span>
                      <span>• UPI <b style={{color:'#16a34a'}}>₹42,300</b></span>
                      <span>• Credit <b style={{color:'#16a34a'}}>₹14,150</b></span>
                    </div>
                    <div style={{marginTop:8,paddingTop:8,borderTop:'1px solid #f0f2f5',
                      fontSize:12.5,color:'#475569'}}>
                      Petrol leads with <b>1,204 L</b> dispensed today.
                    </div>
                  </div>
                </div>
              </div>

              {/* Input bar (decorative) */}
              <div style={{padding:'10px 12px',borderTop:'1px solid #eef1f4',background:'#fff',
                display:'flex',alignItems:'center',gap:8}}>
                <div style={{width:34,height:34,borderRadius:8,background:'#f1f5f9',
                  display:'flex',alignItems:'center',justifyContent:'center',color:'#64748b',flexShrink:0}}>
                  <Mic size={16}/>
                </div>
                <div style={{flex:1,height:34,borderRadius:8,border:'1px solid #e5e7eb',background:'#fff',
                  display:'flex',alignItems:'center',padding:'0 12px',fontSize:12.5,color:'#9ca3af'}}>
                  Ask anything… या किसी भी भाषा में
                </div>
                <div style={{width:34,height:34,borderRadius:8,background:'#FF6B00',
                  display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',flexShrink:0}}>
                  <Send size={15}/>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Responsive: two columns on desktop, stacked + centered on mobile */}
        <style>{`
          .pmp-hero { grid-template-columns: 1.05fr 0.95fr; }
          .pmp-hero-text { text-align: left; }
          .pmp-hero-badges { justify-content: flex-start; }
          @media (max-width: 880px) {
            .pmp-hero { grid-template-columns: 1fr; gap: 2.5rem; }
            .pmp-hero-text { text-align: center; }
            .pmp-hero-badges { justify-content: center; }
          }
        `}</style>
      </section>

      {/* ── Voice POS Highlight ── */}
      <section style={{background:'#fff7ed',padding:'5rem 5%',borderTop:'3px solid #FF6B00'}}>
        <div className="pmp-2col" style={{maxWidth:1100,margin:'0 auto',display:'grid',
          gap:'4rem',alignItems:'center'}}>
          <div>
            <div style={{display:'inline-block',background:'#FF6B00',color:'#fff',
              padding:'4px 12px',borderRadius:99,fontSize:12,fontWeight:700,marginBottom:'1rem'}}>
              🆕 NEW FEATURE
            </div>
            <h2 style={{fontSize:'clamp(1.8rem,3vw,2.5rem)',fontWeight:900,lineHeight:1.2,marginBottom:'1rem'}}>
              Record transactions by{' '}
              <span style={{color:'#FF6B00'}}>speaking</span> in your language
            </h2>
            <p style={{fontSize:16,color:'#555',lineHeight:1.7,marginBottom:'1.5rem'}}>
              Your attendant presses the mic button and says the transaction in Telugu, Tamil, Hindi or any Indian language. 
              Pumpini understands, fills the form, and waits for confirmation. No typing. No errors.
            </p>
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              {[
                ['తెలుగు', '"యాభై లీటర్లు పెట్రోల్ నగదు"', '50L Petrol · Cash'],
                ['தமிழ்',  '"ஐம்பது லிட்டர் டீசல் UPI"',    '50L Diesel · UPI'],
                ['हिन्दी', '"पचास लीटर पेट्रोल कैश"',       '50L Petrol · Cash'],
              ].map(([lang, spoken, parsed]) => (
                <div key={lang} style={{background:'#fff',borderRadius:12,padding:'0.75rem 1rem',
                  border:'1px solid #fed7aa',display:'flex',alignItems:'center',gap:12}}>
                  <span style={{fontSize:11,fontWeight:700,color:'#9a3412',background:'#fee2e2',
                    padding:'2px 8px',borderRadius:99,flexShrink:0}}>{lang}</span>
                  <span style={{fontSize:14,color:'#555',flex:1}}>{spoken}</span>
                  <span style={{fontSize:12,fontWeight:700,color:'#16a34a',
                    background:'#dcfce7',padding:'2px 8px',borderRadius:99,flexShrink:0}}>→ {parsed}</span>
                </div>
              ))}
            </div>
            <div style={{marginTop:'1rem',fontSize:12,color:'#888'}}>
              Powered by Sarvam AI — India's sovereign AI platform for Indian languages
            </div>
          </div>
          <div style={{background:'#0F1923',borderRadius:20,padding:'2rem',position:'relative'}}>
            <div style={{textAlign:'center',marginBottom:'1.5rem'}}>
              <div style={{fontSize:13,color:'rgba(255,255,255,.5)',marginBottom:'0.5rem'}}>POS Entry</div>
              <div style={{fontSize:11,color:'rgba(255,255,255,.3)'}}>Dilsukhnagar Bunk · Shift 1</div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:'1rem'}}>
              {[['N1','Petrol','₹102/L'],['N2','Diesel','₹90/L']].map(([n,f,p])=>(
                <div key={n} style={{background:'rgba(255,107,0,.2)',border:'2px solid #FF6B00',
                  borderRadius:10,padding:'0.75rem',textAlign:'center'}}>
                  <div style={{fontWeight:800,color:'#FF6B00',fontSize:16}}>{n}</div>
                  <div style={{color:'rgba(255,255,255,.7)',fontSize:12}}>{f}</div>
                  <div style={{color:'rgba(255,255,255,.5)',fontSize:11}}>{p}</div>
                </div>
              ))}
            </div>
            <div style={{background:'rgba(255,255,255,.05)',borderRadius:10,padding:'0.75rem',
              textAlign:'center',marginBottom:'1rem'}}>
              <div style={{width:48,height:48,borderRadius:'50%',background:'#FF6B00',
                display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 8px',
                boxShadow:'0 0 0 8px rgba(255,107,0,.2)'}}>
                <span style={{fontSize:22}}>🎙</span>
              </div>
              <div style={{color:'rgba(255,255,255,.7)',fontSize:13,fontStyle:'italic'}}>
                "50 లీటర్లు పెట్రోల్ నగదు"
              </div>
            </div>
            <div style={{background:'rgba(22,163,74,.15)',border:'1px solid rgba(22,163,74,.3)',
              borderRadius:10,padding:'0.75rem',fontSize:12}}>
              <div style={{display:'flex',justifyContent:'space-between',color:'rgba(255,255,255,.6)',marginBottom:4}}>
                <span>Quantity</span><span style={{fontWeight:700,color:'#fff'}}>50 Litres</span>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',color:'rgba(255,255,255,.6)',marginBottom:4}}>
                <span>Payment</span><span style={{fontWeight:700,color:'#fff'}}>Cash</span>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',color:'rgba(255,255,255,.6)'}}>
                <span>Amount</span><span style={{fontWeight:700,color:'#16a34a'}}>₹5,100</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Geo-fencing Highlight ── */}
      <section style={{padding:'5rem 5%',background:'#0F1923',color:'#fff'}}>
        <div className="pmp-2col" style={{maxWidth:1100,margin:'0 auto',display:'grid',
          gap:'4rem',alignItems:'center'}}>
          <div style={{background:'rgba(255,255,255,.05)',borderRadius:20,padding:'2rem',
            border:'1px solid rgba(255,255,255,.1)',textAlign:'center'}}>
            <div style={{fontSize:64,marginBottom:'1rem'}}>📍</div>
            <div style={{width:200,height:200,borderRadius:'50%',border:'2px dashed rgba(255,107,0,.5)',
              margin:'0 auto',display:'flex',alignItems:'center',justifyContent:'center',position:'relative'}}>
              <div style={{width:140,height:140,borderRadius:'50%',border:'2px dashed rgba(255,107,0,.3)',
                display:'flex',alignItems:'center',justifyContent:'center'}}>
                <div style={{width:80,height:80,borderRadius:'50%',border:'2px dashed rgba(255,107,0,.2)',
                  display:'flex',alignItems:'center',justifyContent:'center'}}>
                  <div style={{width:16,height:16,borderRadius:'50%',background:'#FF6B00',
                    boxShadow:'0 0 0 4px rgba(255,107,0,.3)'}}/>
                </div>
              </div>
              <div style={{position:'absolute',top:'15%',right:'5%',fontSize:20}}>✅</div>
              <div style={{position:'absolute',bottom:'5%',left:'0%',fontSize:20}}>🚫</div>
            </div>
            <div style={{marginTop:'1rem',fontSize:13,color:'rgba(255,255,255,.5)'}}>
              500m geo-fence around station
            </div>
          </div>
          <div>
            <div style={{display:'inline-block',background:'rgba(255,107,0,.2)',color:'#FF6B00',
              padding:'4px 12px',borderRadius:99,fontSize:12,fontWeight:700,marginBottom:'1rem',
              border:'1px solid rgba(255,107,0,.3)'}}>
              🆕 GEO-FENCING SECURITY
            </div>
            <h2 style={{fontSize:'clamp(1.8rem,3vw,2.5rem)',fontWeight:900,lineHeight:1.2,marginBottom:'1rem'}}>
              POS locked to your{' '}
              <span style={{color:'#FF6B00'}}>station location</span>
            </h2>
            <p style={{fontSize:16,color:'rgba(255,255,255,.7)',lineHeight:1.7,marginBottom:'1.5rem'}}>
              Staff can only record transactions when physically present at the petrol station. 
              Set a 500m radius — anyone outside that boundary sees the POS locked.
            </p>
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              {[
                ['🔒', 'Attendant outside boundary → POS locked automatically'],
                ['⚡', 'Fired someone? Revoke access instantly from admin panel'],
                ['📍', 'Set station GPS with one click from any device'],
                ['⚙️',  'Configurable radius: 100m to 2km per station'],
              ].map(([icon, text]) => (
                <div key={text} style={{display:'flex',alignItems:'flex-start',gap:12,fontSize:14,
                  color:'rgba(255,255,255,.8)'}}>
                  <span style={{fontSize:18,flexShrink:0}}>{icon}</span>
                  <span>{text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Features Grid ── */}
      <section id="features" style={{padding:'5rem 5%',background:'#F4F7FA'}}>
        <div style={{maxWidth:1100,margin:'0 auto'}}>
          <div style={{textAlign:'center',marginBottom:'3rem'}}>
            <h2 style={{fontSize:'clamp(1.8rem,3vw,2.5rem)',fontWeight:900,marginBottom:'0.5rem'}}>
              {c.feat_title}
            </h2>
            <p style={{fontSize:16,color:'#666'}}>{c.feat_sub}</p>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:'1.5rem'}}>
            {FEATURES.map(feat => (
              <div key={feat.key} style={{background:'#fff',borderRadius:16,padding:'1.75rem',
                border:'1px solid #e5e3de',transition:'all .2s',cursor:'default'}}
                onMouseEnter={e=>{ e.currentTarget.style.transform='translateY(-4px)'; e.currentTarget.style.boxShadow='0 12px 40px rgba(0,0,0,.1)'; }}
                onMouseLeave={e=>{ e.currentTarget.style.transform='none'; e.currentTarget.style.boxShadow='none'; }}>
                <div style={{fontSize:36,marginBottom:'1rem'}}>{feat.icon}</div>
                <h3 style={{fontWeight:800,fontSize:17,marginBottom:'0.5rem'}}>{c[`${feat.key}_t`]}</h3>
                <p style={{fontSize:14,color:'#666',lineHeight:1.6}}>{c[`${feat.key}_d`]}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Comparison table ── */}
      <section style={{padding:'5rem 5%',background:'#fff'}}>
        <div style={{maxWidth:820,margin:'0 auto'}}>
          <h2 style={{textAlign:'center',fontSize:'clamp(1.8rem,3vw,2.5rem)',fontWeight:900,marginBottom:'0.75rem'}}>
            {c.compare_title}
          </h2>
          <p style={{textAlign:'center',fontSize:16,color:'#555',fontStyle:'italic',
            maxWidth:620,margin:'0 auto 2.5rem',lineHeight:1.6}}>
            Others leave bunks running high and dry. Pumpini accounts for every
            drop — and every rupee. We match the basics, then go where legacy
            software can&apos;t.
          </p>
          <div style={{borderRadius:16,overflow:'hidden',border:'1px solid #e5e3de'}}>
            <div className="pmp-cmp" style={{display:'grid',
              background:'#0F1923',color:'#fff',padding:'1rem 1.5rem',fontWeight:700,fontSize:14}}>
              <div>Feature</div>
              <div style={{textAlign:'center',color:'#FF6B00'}}>Us</div>
              <div style={{textAlign:'center',color:'rgba(255,255,255,.45)'}}>Others</div>
            </div>
            {COMPARE.map(([feat, us, them], i) => (
              <div key={feat} className="pmp-cmp" style={{display:'grid',
                padding:'0.875rem 1.5rem',background: i%2===0?'#fff':'#f8f7f5',
                borderBottom:'1px solid #f0f0f0',fontSize:14,alignItems:'center'}}>
                <div style={{fontWeight:500}}>{feat}</div>
                <div style={{textAlign:'center',fontSize:18}}>{CMP_MARK[us]}</div>
                <div style={{textAlign:'center',fontSize:18}}>{CMP_MARK[them]}</div>
              </div>
            ))}
          </div>
          <div style={{textAlign:'center',marginTop:'1rem',fontSize:12.5,color:'#888'}}>
            ✅ included · ⚠️ only with some vendors / basic version · ❌ not available
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" style={{padding:'5rem 5%',background:'#F4F7FA'}}>
        <div style={{maxWidth:900,margin:'0 auto'}}>
          <div style={{textAlign:'center',marginBottom:'3rem'}}>
            <h2 style={{fontSize:'clamp(1.8rem,3vw,2.5rem)',fontWeight:900,marginBottom:'0.5rem'}}>
              {c.pricing_title}
            </h2>
            <p style={{fontSize:15,color:'#666'}}>{c.pricing_sub}</p>
          </div>
          <div className="pmp-2col" style={{display:'grid',gap:'1.5rem',maxWidth:700,margin:'0 auto'}}>
            {PLANS.map(plan => (
              <div key={plan.name} style={{background:'#fff',borderRadius:20,padding:'2rem',
                border: plan.popular ? `2px solid #FF6B00` : '1px solid #e5e3de',
                position:'relative',boxShadow: plan.popular ? '0 8px 40px rgba(255,107,0,.15)' : 'none'}}>
                {plan.popular && (
                  <div style={{position:'absolute',top:-13,left:'50%',transform:'translateX(-50%)',
                    background:'#FF6B00',color:'#fff',padding:'4px 16px',borderRadius:99,
                    fontSize:12,fontWeight:700,whiteSpace:'nowrap'}}>
                    MOST POPULAR
                  </div>
                )}
                <div style={{fontWeight:900,fontSize:18,color:plan.color,marginBottom:'0.25rem'}}>
                  {plan.name}
                </div>
                <div style={{display:'flex',alignItems:'baseline',gap:4,marginBottom:'1.5rem'}}>
                  <span style={{fontSize:32,fontWeight:900}}>{plan.price}</span>
                  <span style={{fontSize:14,color:'#888'}}>{plan.period}</span>
                </div>
                <ul style={{listStyle:'none',padding:0,margin:'0 0 1.5rem',
                  display:'flex',flexDirection:'column',gap:8}}>
                  {plan.features.map(f => (
                    <li key={f} style={{display:'flex',alignItems:'flex-start',gap:8,fontSize:13}}>
                      <span style={{color:'#16a34a',flexShrink:0,marginTop:1}}>✓</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/login" style={{display:'block',textAlign:'center',padding:'12px',
                  background: plan.popular ? '#FF6B00' : '#0F1923',color:'#fff',borderRadius:10,
                  textDecoration:'none',fontWeight:700,fontSize:14}}>
                  Start Free Trial
                </Link>
              </div>
            ))}
          </div>
          <div style={{textAlign:'center',marginTop:'2rem',fontSize:13,color:'#888'}}>
            Need more stations or custom pricing?{' '}
            <a href="https://wa.me/919490704075" style={{color:'#FF6B00',fontWeight:600}}>
              WhatsApp us →
            </a>
          </div>
        </div>
      </section>

      {/* ── Footer CTA / Contact form ── */}
      <section id="contact" style={{padding:'5rem 5%',
        background:'linear-gradient(135deg, #0F1923 0%, #1A2E3B 100%)',
        color:'#fff',textAlign:'center'}}>
        <div style={{maxWidth:560,margin:'0 auto'}}>
          <div style={{fontSize:48,marginBottom:'1rem'}}>🚀</div>
          <h2 style={{fontSize:'clamp(1.8rem,3vw,2.5rem)',fontWeight:900,marginBottom:'0.75rem'}}>
            Get in touch — we&apos;ll set up your free trial
          </h2>
          <p style={{fontSize:16,color:'rgba(255,255,255,.6)',marginBottom:'2rem'}}>
            Leave your details and our team will reach out to activate your
            15-day free trial. Prefer not to share your personal number? Just
            give us your bunk manager&apos;s contact.
          </p>

          <form onSubmit={submitLead} style={{background:'#fff',borderRadius:16,padding:'1.75rem',
            textAlign:'left',boxShadow:'0 20px 60px rgba(0,0,0,.35)',position:'relative'}}>
            {leadState === 'done' ? (
              <div style={{textAlign:'center',padding:'1.5rem 0'}}>
                <div style={{fontSize:44,marginBottom:'0.75rem'}}>✅</div>
                <div style={{fontSize:18,fontWeight:800,color:'#0F1923',marginBottom:6}}>Thank you!</div>
                <div style={{fontSize:14,color:'#555',lineHeight:1.6}}>
                  We&apos;ve received your details and will reach out shortly to set up your free trial.
                </div>
              </div>
            ) : (
              <>
                {/* Honeypot — hidden from humans, traps bots */}
                <input type="text" name="company" value={lead.company} tabIndex={-1} autoComplete="off"
                  aria-hidden="true" onChange={e=>setL('company', e.target.value)}
                  style={{position:'absolute',left:'-9999px',width:1,height:1,opacity:0}}/>

                <div className="pmp-form2" style={{display:'grid',gap:12,marginBottom:12}}>
                  <input style={leadInp} placeholder="Your name *" value={lead.name}
                    onChange={e=>setL('name', e.target.value)} required/>
                  <input style={leadInp} type="tel" placeholder="Mobile number *" value={lead.phone}
                    onChange={e=>setL('phone', e.target.value)} required/>
                  <input style={leadInp} placeholder="Petrol bunk name" value={lead.station_name}
                    onChange={e=>setL('station_name', e.target.value)}/>
                  <input style={leadInp} placeholder="City" value={lead.city}
                    onChange={e=>setL('city', e.target.value)}/>
                </div>
                <textarea style={{...leadInp, minHeight:72, resize:'vertical', marginBottom:12}}
                  placeholder="Anything you'd like to tell us? (optional)" value={lead.message}
                  onChange={e=>setL('message', e.target.value)}/>

                {leadState === 'error' && (
                  <div style={{background:'#fee2e2',color:'#991b1b',borderRadius:8,padding:'10px 12px',
                    fontSize:13,marginBottom:12,border:'1px solid #fca5a5'}}>
                    Something went wrong. Please try again, or message us on WhatsApp.
                  </div>
                )}

                <button type="submit" disabled={leadState==='sending'}
                  style={{width:'100%',height:50,background:'#FF6B00',color:'#fff',border:'none',
                    borderRadius:10,fontSize:16,fontWeight:800,cursor:'pointer',
                    boxShadow:'0 4px 20px rgba(255,107,0,.35)'}}>
                  {leadState==='sending' ? 'Sending…' : 'Get in touch'}
                </button>
                <div style={{fontSize:12,color:'#888',textAlign:'center',marginTop:10}}>
                  15-day free trial · No credit card · We&apos;ll never spam you.
                </div>
              </>
            )}
          </form>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{background:'#080f15',color:'rgba(255,255,255,.4)',
        padding:'1.5rem 5%',display:'flex',justifyContent:'space-between',
        alignItems:'center',flexWrap:'wrap',gap:8,fontSize:13}}>
        <div>
          <span style={{fontWeight:900,color:'#fff'}}>
            <span style={{color:'#FF6B00'}}>pump</span><span style={{color:'#4DC3E8'}}>ini</span>
          </span>
          {' '}© 2026 · Built for Indian petrol stations
        </div>
        <div style={{display:'flex',gap:'1.5rem'}}>
          <Link href="/login"   style={{color:'rgba(255,255,255,.4)',textDecoration:'none'}}>Login</Link>
          <Link href="/landing" style={{color:'rgba(255,255,255,.4)',textDecoration:'none'}}>Home</Link>
        </div>
      </footer>

      {/* ── Floating WhatsApp button ── */}
      <a
        href="https://wa.me/917842178350?text=Hi%2C%20I%27d%20like%20to%20know%20more%20about%20Pumpini"
        target="_blank" rel="noopener noreferrer"
        aria-label="Chat on WhatsApp"
        style={{
          position:'fixed',bottom:24,right:24,zIndex:1000,
          width:58,height:58,borderRadius:'50%',background:'#25D366',
          display:'flex',alignItems:'center',justifyContent:'center',
          boxShadow:'0 6px 24px rgba(37,211,102,.5)',
          textDecoration:'none',transition:'transform .2s',
        }}
        onMouseEnter={e=>e.currentTarget.style.transform='scale(1.08)'}
        onMouseLeave={e=>e.currentTarget.style.transform='scale(1)'}
      >
        <svg viewBox="0 0 32 32" width="32" height="32" fill="#fff" aria-hidden="true">
          <path d="M16.04 4C9.4 4 4 9.4 4 16.04c0 2.12.56 4.18 1.6 6L4 28l6.13-1.6a12 12 0 0 0 5.9 1.54h.01C22.67 27.95 28 22.6 28 16.04 28 9.4 22.67 4 16.04 4zm0 21.9h-.01a9.9 9.9 0 0 1-5.05-1.38l-.36-.22-3.74.98 1-3.64-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.46 4.45-9.9 9.92-9.9 2.65 0 5.14 1.04 7.01 2.91a9.82 9.82 0 0 1 2.9 7c0 5.46-4.45 9.88-9.92 9.88zm5.44-7.41c-.3-.15-1.77-.87-2.04-.97-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.18.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.21-.24-.58-.49-.5-.67-.51l-.57-.01c-.2 0-.52.07-.79.37-.27.3-1.04 1.01-1.04 2.47 0 1.46 1.06 2.87 1.21 3.07.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2.01-1.42.25-.69.25-1.28.17-1.41-.07-.13-.27-.2-.57-.35z"/>
        </svg>
      </a>
    </div>
  );
}
