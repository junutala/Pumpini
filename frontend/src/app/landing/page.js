'use client';
// Pumpini landing v2 — money-first design for bunk owners.
// The previous design is preserved at /landing/classic (instant revert:
// copy classic/page.js over this file and fix the india import path).
import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Zap, Mic, Send } from 'lucide-react';
import { INDIAN_STATES, getCities } from '../../lib/india';

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
    sub:     'Your counter moves lakhs every day. Pumpini is the owner\'s ledger that never sleeps — every nozzle, every shift, every rupee accounted for, in your language.',
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
    nav_leak:'Pumpini AI', nav_features:'Features', nav_pricing:'Pricing', nav_contact:'Contact', login:'Login', home:'Home',
    hero_badge:'AI-powered control room for your bunk',
    cta_leak:'Meet your AI manager →',
    cards_t:'Three things your friends\' bunks don\'t have.',
    cards_sub:'Lead with these at the next dealers\' meet.',
    c1_t:'Ask. It answers.', c1_chip:'AI assistant',
    c1_d:'“How much diesel did we sell yesterday? Who owes me the most?” Ask in your language — Pumpini AI answers from your bunk\'s own data.',
    c2_t:'Wet & dry. Both covered.', c2_chip:'Complete coverage',
    c2_d:'Tank dips, density, deliveries, nozzle readings — and lubes, barcodes, GST stock. Most software picks one side. Pumpini runs both.',
    c3_t:'Cash counted honestly.', c3_chip:'No-hints cash check',
    c3_d:'Your staff counts and declares the cash first — the expected total stays hidden until then. No target to “match”, nothing to pocket.',
    ai_badge:'PUMPINI AI', ai_lang:'Works in all 6 languages',
    ai_old:'“What happened today?”', ai_old_s:'every other software',
    ai_new:'“What happens tomorrow?”', ai_new_s:'only Pumpini AI',
    ai_title:'Reports tell you what happened. Pumpini tells you what\'s coming.',
    ai_sub:'A new way to run a bunk: stop stitching yesterday\'s pieces together — see tomorrow before it arrives.',
    ai_q:'Do I need a tanker before the weekend?',
    ai_a:'Yes — at this week\'s pace, Tank 1 hits reserve by Saturday evening. Holiday traffic adds ~9%. Book the tanker for Friday.',
    ai_alerts_t:'Caught today, before it costs you tomorrow:',
    ai_al1:'⛽ Tank 2 variance is drifting — at this pace you lose ~700 L this month. Check Tuesday night shifts now.',
    ai_al2:'💸 Cash shortfalls repeat on one attendant\'s shifts — same ₹300–500. The next one is predictable. Watch tonight.',
    ai_al3:'🧾 A credit customer is paying slower while pumping more — ₹1.9 lakh at risk if the pattern holds. Call before the next fill.',
    ai_note:'Evaporation, stock loss, cash shortage, credit risk — Pumpini AI reads the pattern and warns you in time, not in the post-mortem.',
    ez_title:'Easy to use. And it covers everything.',
    ez_sub:'Every other option makes you choose. Pumpini doesn\'t.',
    ez_x:'Easier to use →', ez_y:'↑ Covers more',
    ez_d1:'Old desktop software', ez_d2:'Simple billing apps', ez_d3:'Diary & registers',
    ez_we_sub:'AI + voice + full coverage',
    hb1:'Voice in 6 languages', hb2:'AI assistant inside', hb3:'GPS-locked POS',
    ph_title:'Today at your bunk', ph_sub:'What only the owner sees', ph_live:'LIVE',
    ph_sales:'Sales till now', ph_fills:'2,389 litres · 318 fills',
    ph_cash:'Cash', ph_credit:'Credit',
    ph_shift:'Shift 2 — open', ph_hidden:'Staff see: amount hidden until shift closes',
    ph_tank:'Tank variance:', ph_tankok:'−34 L · within limit',
    ph_deposit:'₹1,42,000 not deposited — 2 days', ph_alert:'ALERT',
    ph_note:'Every number above updates live, in your language, on your phone.',
    permo:'/month',
    bd_badge:'ONLY ON PUMPINI — THE HONEST CASH COUNT',
    bd_title:'The counter that can’t cheat.',
    bd_sub:'In most bunks, the attendant knows exactly how much cash should be in the drawer — so the drawer always “matches”. Pumpini flips the game.',
    bd_wo:'WITHOUT PUMPINI', bd_w:'WITH PUMPINI',
    bd_wo1:'Attendant sees the expected total before counting',
    bd_wo2:'Keeps the round-off, shorts the change, pockets the gap',
    bd_wo3:'Drawer “tallies perfectly” every single day',
    bd_wo4:'You sense it, but you can never prove it',
    bd_w1:'Sale total stays hidden while the shift is open — even from managers',
    bd_w2:'Attendant declares his cash first, then the system reveals the truth',
    bd_w3:'Every shortfall recorded — name, shift, amount, pattern',
    bd_w4:'Honest staff feel protected. The other kind quits on their own.',
    bd_close:'Only the owner sees open-shift sales. Not the manager. Not the shift lead.', bd_you:'You.',
    vp_badge:'VOICE POS', vp_pre:'Your attendant just ', vp_hl:'says it', vp_post:'. Pumpini writes it.',
    vp_sub:'No typing, no training, no excuses. He presses the mic and speaks in Telugu, Tamil, Hindi — any Indian language. The entry fills itself and waits for one tap to confirm.',
    vp_note:'Understands 6 Indian languages — voice entry built for how India speaks.',
    vp_pos:'POS Entry', vp_qty:'Quantity', vp_pay:'Payment', vp_amt:'Amount', vp_50l:'50 Litres',
    gf_title:'POS works only inside your bunk’s gate.',
    gf_sub:'GPS geo-fence from 100m to 2km. Outside the boundary, the POS locks itself. Fired someone? One tap and their access is gone — from anywhere.',
    gf_inc:'Included in every plan',
    cmp_sub:'Others leave bunks running high and dry. Pumpini accounts for every drop — and every rupee. We match the basics, then go where legacy software can’t.',
    cmp_feature:'Feature', cmp_others:'Others',
    cmp_legend:'✅ included · ⚠️ only with some vendors / basic version · ❌ not available',
    cmp_rows:['Billing & GST invoices','Shift & cash reconciliation','Tank stock & nozzle readings','Credit / corporate customers','Cloud + mobile app','Instant in-app alerts','Voice POS in Indian languages','Full app in 6 Indian languages','GPS geo-fencing security','Blind-drop cash control','AI assistant — ask your data','Real-time live dashboard'],
    pr_pop:'MOST POPULAR', pr_cta:'Start Free Trial',
    pr_foot:'Your bunk pumps lakhs through the counter daily — protect it for less than one litre of petrol a day.',
    pr_more:'Need more stations? Get in touch →',
    plan_starter:{tag:'Control every drop & rupee — one bunk', perday:'₹20 a day', note:'two cups of chai',
      feats:['1 petrol station','Unlimited nozzles & tanks','Voice POS entry · 6 Indian languages','Blind-drop shift reconciliation','Wet-stock (tank dip) reconciliation','Live tank variance alerts','Petty cash + bank deposit tracking','Dipstick & deliveries','Real-time dashboard & reports','Geo-fencing security']},
    plan_pro:{tag:'Run the full business — one bunk', perday:'₹33 a day', note:'a third of a litre of petrol',
      feats:['Everything in Starter','Credit customers & GST invoices','Credit receipts & notes','Lubes & products (barcode)','Cash integrity monitoring','Tally Prime export','AI assistant']},
    plan_ent:{tag:'For a group of bunks', perday:'₹66 a day', note:'for up to 5 bunks',
      feats:['Everything in Pro','Up to 5 petrol stations','Group dashboard','Multi-station reports','Corporate PAN fleet portal','Priority support']},
    ct_title:'Get in touch — we’ll set up your free trial',
    ct_sub:'Leave your details and our team will reach out to activate your 15-day free trial. No card, no commitment — just your bunk, under control.',
    ct_bunk:'Petrol bunk name', ct_name:'Your name *', ct_phone:'Mobile number *',
    ct_state:'State', ct_city:'City', ct_cityfirst:'Select state first',
    ct_msg:'Anything you’d like to tell us? (optional)',
    ct_err:'Something went wrong. Please try again in a moment.',
    ct_send:'Get in touch', ct_sending:'Sending…',
    ct_note:'15-day free trial · No credit card · We’ll never spam you.',
    ct_thanks:'Thank you!', ct_thanks_sub:'We’ve received your details and will reach out shortly to set up your free trial.',
  },
  hi: {
    hero:    'हर बूंद पर नियंत्रण।',
    hero2:   'हर रुपया ट्रैक करें।',
    sub:     'आपके काउंटर से रोज़ लाखों गुज़रते हैं। Pumpini मालिक का वो बहीखाता है जो कभी सोता नहीं — हर नोज़ल, हर शिफ्ट, हर रुपये का हिसाब, आपकी भाषा में।',
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
    nav_leak:'Pumpini AI', nav_features:'फ़ीचर्स', nav_pricing:'कीमत', nav_contact:'संपर्क', login:'लॉगिन', home:'होम',
    hero_badge:'आपके पंप का AI-पावर्ड कंट्रोल रूम',
    cta_leak:'अपने AI मैनेजर से मिलिए →',
    cards_t:'तीन चीज़ें जो आपके दोस्तों के पंप पर नहीं हैं।',
    cards_sub:'अगली डीलर्स मीटिंग में शुरुआत इन्हीं से कीजिए।',
    c1_t:'पूछिए। जवाब हाज़िर।', c1_chip:'AI असिस्टेंट',
    c1_d:'“कल कितना डीज़ल बिका? सबसे ज़्यादा उधारी किसकी है?” अपनी भाषा में पूछिए — Pumpini AI आपके पंप के अपने डेटा से जवाब देता है।',
    c2_t:'वेट और ड्राई। दोनों कवर।', c2_chip:'पूरा कवरेज',
    c2_d:'टैंक डिप, डेंसिटी, डिलीवरी, नोज़ल रीडिंग — और लुब्स, बारकोड, GST स्टॉक भी। बाकी सॉफ्टवेयर एक तरफ चुनते हैं। Pumpini दोनों चलाता है।',
    c3_t:'कैश की ईमानदार गिनती।', c3_chip:'बिना-हिंट कैश चेक',
    c3_d:'स्टाफ पहले कैश गिनकर बताता है — तब तक अपेक्षित रकम छिपी रहती है। “मैच” करने का कोई टारगेट नहीं, जेब में डालने का कोई रास्ता नहीं।',
    ai_badge:'PUMPINI AI', ai_lang:'सभी 6 भाषाओं में',
    ai_old:'“आज क्या हुआ?”', ai_old_s:'बाकी हर सॉफ्टवेयर',
    ai_new:'“कल क्या होगा?”', ai_new_s:'सिर्फ Pumpini AI',
    ai_title:'रिपोर्टें बताती हैं क्या हुआ। Pumpini बताता है क्या होने वाला है।',
    ai_sub:'पंप चलाने का नया तरीका: कल के टुकड़े जोड़ना बंद कीजिए — कल को आने से पहले देखिए।',
    ai_q:'क्या वीकेंड से पहले टैंकर मंगवाना होगा?',
    ai_a:'हाँ — इस हफ्ते की रफ्तार से टैंक 1 शनिवार शाम तक रिज़र्व पर पहुंच जाएगा। छुट्टी का ट्रैफिक ~9% और जोड़ेगा। टैंकर शुक्रवार के लिए बुक करें।',
    ai_alerts_t:'आज पकड़ा — कल का नुकसान होने से पहले:',
    ai_al1:'⛽ टैंक 2 का वेरिएंस बढ़ रहा है — इसी रफ्तार से इस महीने ~700 L का नुकसान। मंगलवार की नाइट शिफ्ट अभी जांचें।',
    ai_al2:'💸 एक अटेंडेंट की शिफ्ट में कैश बार-बार कम — वही ₹300–500। अगली बार का अंदाज़ा लगाया जा सकता है। आज रात नज़र रखें।',
    ai_al3:'🧾 एक क्रेडिट ग्राहक भुगतान धीमा कर रहा है और तेल ज़्यादा भरवा रहा है — पैटर्न चला तो ₹1.9 लाख फंस सकते हैं। अगली फिलिंग से पहले फोन करें।',
    ai_note:'वाष्पीकरण, स्टॉक लॉस, कैश की कमी, क्रेडिट रिस्क — Pumpini AI पैटर्न पढ़कर समय रहते चेताता है, पोस्टमार्टम में नहीं।',
    ez_title:'चलाने में आसान। और सब कुछ कवर।',
    ez_sub:'बाकी सब आपसे एक चुनवाते हैं। Pumpini नहीं।',
    ez_x:'आसान →', ez_y:'↑ ज़्यादा कवरेज',
    ez_d1:'पुराने डेस्कटॉप सॉफ्टवेयर', ez_d2:'सिंपल बिलिंग ऐप्स', ez_d3:'डायरी और रजिस्टर',
    ez_we_sub:'AI + वॉयस + पूरा कवरेज',
    hb1:'6 भाषाओं में आवाज़', hb2:'AI असिस्टेंट साथ में', hb3:'GPS-लॉक्ड POS',
    ph_title:'आज आपके पंप पर', ph_sub:'जो सिर्फ मालिक देखता है', ph_live:'लाइव',
    ph_sales:'अब तक की बिक्री', ph_fills:'2,389 लीटर · 318 गाड़ियाँ',
    ph_cash:'कैश', ph_credit:'क्रेडिट',
    ph_shift:'शिफ्ट 2 — चालू', ph_hidden:'स्टाफ को: शिफ्ट बंद होने तक रकम छिपी रहती है',
    ph_tank:'टैंक वेरिएंस:', ph_tankok:'−34 L · सीमा में',
    ph_deposit:'₹1,42,000 जमा नहीं हुआ — 2 दिन', ph_alert:'अलर्ट',
    ph_note:'ऊपर का हर आंकड़ा लाइव अपडेट होता है — आपकी भाषा में, आपके फोन पर।',
    permo:'/महीना',
    bd_badge:'सिर्फ PUMPINI पर — कैश की ईमानदार गिनती',
    bd_title:'वो काउंटर जो धोखा नहीं दे सकता।',
    bd_sub:'ज़्यादातर पंपों पर अटेंडेंट को ठीक-ठीक पता होता है कि दराज़ में कितना कैश होना चाहिए — इसलिए दराज़ हमेशा “मैच” करती है। Pumpini खेल पलट देता है।',
    bd_wo:'PUMPINI के बिना', bd_w:'PUMPINI के साथ',
    bd_wo1:'अटेंडेंट गिनने से पहले ही अपेक्षित रकम देख लेता है',
    bd_wo2:'राउंड-ऑफ रख लेता है, कम छुट्टे देता है, फर्क जेब में',
    bd_wo3:'दराज़ हर दिन “बिल्कुल सही मैच” करती है',
    bd_wo4:'आपको महसूस होता है, पर आप कभी साबित नहीं कर पाते',
    bd_w1:'शिफ्ट खुली रहने तक बिक्री की रकम छिपी रहती है — मैनेजर से भी',
    bd_w2:'अटेंडेंट पहले अपना कैश घोषित करता है, फिर सिस्टम सच दिखाता है',
    bd_w3:'हर शॉर्टफॉल रिकॉर्ड — नाम, शिफ्ट, रकम, पैटर्न',
    bd_w4:'ईमानदार स्टाफ सुरक्षित महसूस करता है। दूसरी किस्म खुद छोड़ जाती है।',
    bd_close:'खुली शिफ्ट की बिक्री सिर्फ मालिक देखता है। मैनेजर नहीं। शिफ्ट इंचार्ज नहीं।', bd_you:'सिर्फ आप।',
    vp_badge:'वॉयस POS', vp_pre:'आपका अटेंडेंट बस ', vp_hl:'बोल देता है', vp_post:'। Pumpini लिख लेता है।',
    vp_sub:'न टाइपिंग, न ट्रेनिंग, न बहाने। वह माइक दबाकर तेलुगु, तमिल, हिंदी — किसी भी भारतीय भाषा में बोलता है। एंट्री अपने आप भर जाती है और एक टैप में कन्फर्म।',
    vp_note:'6 भारतीय भाषाएँ समझता है — भारत जैसे बोलता है, वैसी वॉयस एंट्री।',
    vp_pos:'POS एंट्री', vp_qty:'मात्रा', vp_pay:'भुगतान', vp_amt:'रकम', vp_50l:'50 लीटर',
    gf_title:'POS सिर्फ आपके पंप के गेट के अंदर चलता है।',
    gf_sub:'100m से 2km तक GPS जियो-फेंस। सीमा के बाहर POS खुद लॉक हो जाता है। किसी को निकाला? एक टैप और उसका एक्सेस खत्म — कहीं से भी।',
    gf_inc:'हर प्लान में शामिल',
    cmp_sub:'दूसरे सॉफ्टवेयर पंप को अधूरा छोड़ देते हैं। Pumpini हर बूंद — और हर रुपये — का हिसाब रखता है। बेसिक्स में बराबरी, और फिर वहाँ तक जहाँ पुराने सॉफ्टवेयर पहुँच ही नहीं सकते।',
    cmp_feature:'फ़ीचर', cmp_others:'दूसरे',
    cmp_legend:'✅ शामिल · ⚠️ कुछ ही वेंडर / बेसिक वर्ज़न में · ❌ उपलब्ध नहीं',
    cmp_rows:['बिलिंग और GST इनवॉइस','शिफ्ट और कैश मिलान','टैंक स्टॉक और नोज़ल रीडिंग','क्रेडिट / कॉर्पोरेट ग्राहक','क्लाउड + मोबाइल ऐप','तुरंत इन-ऐप अलर्ट','भारतीय भाषाओं में वॉयस POS','6 भारतीय भाषाओं में पूरा ऐप','GPS जियो-फेंसिंग सुरक्षा','ब्लाइंड-ड्रॉप कैश कंट्रोल','AI असिस्टेंट — अपने डेटा से पूछें','रियल-टाइम लाइव डैशबोर्ड'],
    pr_pop:'सबसे लोकप्रिय', pr_cta:'फ्री ट्रायल शुरू करें',
    pr_foot:'आपके पंप के काउंटर से रोज़ लाखों गुज़रते हैं — उसकी हिफ़ाज़त कीजिए, दिन के एक लीटर पेट्रोल से भी कम में।',
    pr_more:'और पंप चाहिए? संपर्क करें →',
    plan_starter:{tag:'हर बूंद और रुपये पर कंट्रोल — एक पंप', perday:'₹20 रोज़', note:'दो कप चाय',
      feats:['1 पेट्रोल पंप','अनलिमिटेड नोज़ल और टैंक','वॉयस POS एंट्री · 6 भारतीय भाषाएँ','ब्लाइंड-ड्रॉप शिफ्ट मिलान','वेट-स्टॉक (टैंक डिप) मिलान','लाइव टैंक वेरिएंस अलर्ट','पेटी कैश + बैंक डिपॉज़िट ट्रैकिंग','डिपस्टिक और डिलीवरी','रियल-टाइम डैशबोर्ड और रिपोर्ट','जियो-फेंसिंग सुरक्षा']},
    plan_pro:{tag:'पूरा कारोबार चलाएँ — एक पंप', perday:'₹33 रोज़', note:'एक तिहाई लीटर पेट्रोल',
      feats:['स्टार्टर का सब कुछ','क्रेडिट ग्राहक और GST इनवॉइस','क्रेडिट रसीदें और नोट्स','लुब्स और प्रोडक्ट्स (बारकोड)','कैश इंटीग्रिटी मॉनिटरिंग','Tally Prime एक्सपोर्ट','AI असिस्टेंट']},
    plan_ent:{tag:'पंपों के ग्रुप के लिए', perday:'₹66 रोज़', note:'5 पंपों तक के लिए',
      feats:['प्रो का सब कुछ','5 पेट्रोल पंप तक','ग्रुप डैशबोर्ड','मल्टी-स्टेशन रिपोर्ट','कॉर्पोरेट PAN फ्लीट पोर्टल','प्रायोरिटी सपोर्ट']},
    ct_title:'संपर्क करें — हम आपका फ्री ट्रायल शुरू करवा देंगे',
    ct_sub:'अपनी जानकारी छोड़ें, हमारी टीम आपका 15-दिन का फ्री ट्रायल शुरू करने के लिए संपर्क करेगी। न कार्ड, न बंधन — बस आपका पंप, आपके कंट्रोल में।',
    ct_bunk:'पेट्रोल पंप का नाम', ct_name:'आपका नाम *', ct_phone:'मोबाइल नंबर *',
    ct_state:'राज्य', ct_city:'शहर', ct_cityfirst:'पहले राज्य चुनें',
    ct_msg:'कुछ और बताना चाहें? (वैकल्पिक)',
    ct_err:'कुछ गड़बड़ हो गई। कृपया थोड़ी देर में फिर कोशिश करें।',
    ct_send:'संपर्क करें', ct_sending:'भेजा जा रहा है…',
    ct_note:'15 दिन फ्री ट्रायल · कोई क्रेडिट कार्ड नहीं · कोई स्पैम नहीं।',
    ct_thanks:'धन्यवाद!', ct_thanks_sub:'आपकी जानकारी मिल गई है। फ्री ट्रायल शुरू करने के लिए हम जल्द ही संपर्क करेंगे।',
  },
  ta: {
    hero:    'ஒவ்வொரு துளியையும் கட்டுப்படுத்துங்கள்.',
    hero2:   'ஒவ்வொரு ரூபாயையும் கண்காணியுங்கள்.',
    sub:     'உங்கள் கவுண்டரில் தினமும் லட்சங்கள் நகர்கின்றன. Pumpini என்பது உறங்காத உரிமையாளரின் கணக்குப் புத்தகம் — ஒவ்வொரு நாஸில், ஒவ்வொரு ஷிஃப்ட், ஒவ்வொரு ரூபாய்க்கும் கணக்கு, உங்கள் மொழியில்.',
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
    nav_leak:'Pumpini AI', nav_features:'அம்சங்கள்', nav_pricing:'விலை', nav_contact:'தொடர்பு', login:'உள்நுழைய', home:'முகப்பு',
    hero_badge:'உங்கள் பங்கின் AI கட்டுப்பாட்டு அறை',
    cta_leak:'உங்கள் AI மேலாளரை சந்தியுங்கள் →',
    cards_t:'உங்கள் நண்பர்களின் பங்குகளில் இல்லாத மூன்று விஷயங்கள்.',
    cards_sub:'அடுத்த டீலர்ஸ் மீட்டிங்கில் இவற்றிலிருந்து தொடங்குங்கள்.',
    c1_t:'கேளுங்கள். பதில் தயார்.', c1_chip:'AI உதவியாளர்',
    c1_d:'“நேற்று எவ்வளவு டீசல் விற்றது? யாரிடம் அதிக கடன்?” உங்கள் மொழியில் கேளுங்கள் — Pumpini AI உங்கள் பங்கின் சொந்த தரவிலிருந்து பதிலளிக்கிறது.',
    c2_t:'வெட் & டிரை. இரண்டும் கவர்.', c2_chip:'முழு கவரேஜ்',
    c2_d:'டேங்க் டிப், அடர்த்தி, டெலிவரி, நாஸில் ரீடிங் — மேலும் லூப்ஸ், பார்கோடு, GST ஸ்டாக். மற்ற மென்பொருட்கள் ஒரு பக்கம்தான். Pumpini இரண்டையும் நடத்துகிறது.',
    c3_t:'பணம் நேர்மையாக எண்ணப்படும்.', c3_chip:'ஹின்ட் இல்லா பணச் சரிபார்ப்பு',
    c3_d:'ஊழியர் முதலில் பணத்தை எண்ணி அறிவிக்கிறார் — அதுவரை எதிர்பார்க்கும் தொகை மறைந்திருக்கும். “மேட்ச்” செய்ய இலக்கு இல்லை, பாக்கெட்டில் போட வழி இல்லை.',
    ai_badge:'PUMPINI AI', ai_lang:'6 மொழிகளிலும்',
    ai_old:'“இன்று என்ன நடந்தது?”', ai_old_s:'மற்ற எல்லா மென்பொருளும்',
    ai_new:'“நாளை என்ன நடக்கும்?”', ai_new_s:'Pumpini AI மட்டும்',
    ai_title:'ரிப்போர்ட்கள் நடந்ததைச் சொல்லும். Pumpini நடக்கப்போவதைச் சொல்லும்.',
    ai_sub:'பங்க் நடத்த புதிய வழி: நேற்றைய துண்டுகளை ஒட்டுவதை நிறுத்துங்கள் — நாளையை வருமுன்பே பாருங்கள்.',
    ai_q:'வீக்கெண்டுக்கு முன் டேங்கர் வேண்டுமா?',
    ai_a:'ஆம் — இந்த வார வேகத்தில் டேங்க் 1 சனி மாலைக்குள் ரிசர்வைத் தொடும். விடுமுறை டிராஃபிக் ~9% கூடும். வெள்ளிக்கிழமைக்கு டேங்கர் புக் செய்யுங்கள்.',
    ai_alerts_t:'நாளை நஷ்டமாகும் முன் — இன்றே பிடிபட்டது:',
    ai_al1:'⛽ டேங்க் 2 வேரியன்ஸ் அதிகரிக்கிறது — இதே வேகத்தில் இந்த மாதம் ~700 L இழப்பு. செவ்வாய் இரவு ஷிஃப்டை இப்போதே சரிபாருங்கள்.',
    ai_al2:'💸 ஒரு ஊழியரின் ஷிஃப்டில் பணம் திரும்பத் திரும்பக் குறைகிறது — அதே ₹300–500. அடுத்தது யூகிக்கக்கூடியது. இன்றிரவு கவனியுங்கள்.',
    ai_al3:'🧾 ஒரு கடன் வாடிக்கையாளர் கட்டணம் தாமதித்து, அதிகம் நிரப்புகிறார் — பேட்டர்ன் தொடர்ந்தால் ₹1.9 லட்சம் ரிஸ்க். அடுத்த நிரப்புதலுக்கு முன் அழையுங்கள்.',
    ai_note:'ஆவியாதல், ஸ்டாக் இழப்பு, பணப் பற்றாக்குறை, கடன் ரிஸ்க் — Pumpini AI பேட்டர்னைப் படித்து சரியான நேரத்தில் எச்சரிக்கிறது, போஸ்ட்மார்ட்டத்தில் அல்ல.',
    ez_title:'பயன்படுத்த எளிது. எல்லாமே கவர்.',
    ez_sub:'மற்றவை ஒன்றைத் தேர்வு செய்ய வைக்கும். Pumpini வேண்டாம் என்கிறது.',
    ez_x:'எளிமை →', ez_y:'↑ அதிக கவரேஜ்',
    ez_d1:'பழைய டெஸ்க்டாப் மென்பொருள்', ez_d2:'சிம்பிள் பில்லிங் ஆப்கள்', ez_d3:'டைரி & ரெஜிஸ்டர்',
    ez_we_sub:'AI + குரல் + முழு கவரேஜ்',
    hb1:'6 மொழிகளில் குரல்', hb2:'AI உதவியாளர் உள்ளே', hb3:'GPS பூட்டிய POS',
    ph_title:'இன்று உங்கள் பங்கில்', ph_sub:'உரிமையாளர் மட்டும் பார்ப்பது', ph_live:'நேரலை',
    ph_sales:'இதுவரை விற்பனை', ph_fills:'2,389 லிட்டர் · 318 நிரப்புதல்',
    ph_cash:'பணம்', ph_credit:'கடன்',
    ph_shift:'ஷிப்ட் 2 — திறந்துள்ளது', ph_hidden:'ஊழியர்களுக்கு: ஷிப்ட் முடியும் வரை தொகை மறைவாக',
    ph_tank:'டேங்க் வேறுபாடு:', ph_tankok:'−34 L · வரம்புக்குள்',
    ph_deposit:'₹1,42,000 வங்கியில் செலுத்தப்படவில்லை — 2 நாட்கள்', ph_alert:'எச்சரிக்கை',
    ph_note:'மேலே உள்ள ஒவ்வொரு எண்ணும் நேரடியாக புதுப்பிக்கப்படுகிறது — உங்கள் மொழியில், உங்கள் போனில்.',
    permo:'/மாதம்',
    bd_badge:'PUMPINI-ல் மட்டும் — நேர்மையான பணக் கணக்கு',
    bd_title:'ஏமாற்ற முடியாத கவுண்டர்.',
    bd_sub:'பெரும்பாலான பங்குகளில், டிராயரில் எவ்வளவு பணம் இருக்க வேண்டும் என்று ஊழியருக்கு துல்லியமாகத் தெரியும் — அதனால் டிராயர் எப்போதும் “சரியாக” இருக்கும். Pumpini விளையாட்டையே மாற்றுகிறது.',
    bd_wo:'PUMPINI இல்லாமல்', bd_w:'PUMPINI உடன்',
    bd_wo1:'எண்ணும் முன்பே ஊழியர் எதிர்பார்க்கப்படும் தொகையைப் பார்க்கிறார்',
    bd_wo2:'ரவுண்ட்-ஆஃப் வைத்துக்கொள்வார், சில்லறை குறைப்பார், மீதி பாக்கெட்டில்',
    bd_wo3:'டிராயர் தினமும் “சரியாக மேட்ச்” ஆகும்',
    bd_wo4:'உங்களுக்கு சந்தேகம் வரும், ஆனால் நிரூபிக்க முடியாது',
    bd_w1:'ஷிப்ட் திறந்திருக்கும் வரை விற்பனைத் தொகை மறைவாக — மேலாளருக்கும் கூட',
    bd_w2:'ஊழியர் முதலில் தன் பணத்தை அறிவிக்கிறார், பின்னர் சிஸ்டம் உண்மையைக் காட்டுகிறது',
    bd_w3:'ஒவ்வொரு பற்றாக்குறையும் பதிவு — பெயர், ஷிப்ட், தொகை, முறை',
    bd_w4:'நேர்மையான ஊழியர்கள் பாதுகாப்பாக உணர்கிறார்கள். மற்ற வகை தானாக விலகுகிறது.',
    bd_close:'திறந்த ஷிப்ட் விற்பனையை உரிமையாளர் மட்டுமே பார்க்கிறார். மேலாளர் இல்லை. ஷிப்ட் தலைவர் இல்லை.', bd_you:'நீங்கள் மட்டுமே.',
    vp_badge:'குரல் POS', vp_pre:'உங்கள் ஊழியர் ', vp_hl:'சொன்னால் போதும்', vp_post:'. Pumpini எழுதிக்கொள்கிறது.',
    vp_sub:'டைப்பிங் இல்லை, பயிற்சி இல்லை, சாக்கு இல்லை. மைக்கை அழுத்தி தமிழ், தெலுங்கு, இந்தி — எந்த இந்திய மொழியிலும் பேசுகிறார். பதிவு தானாக நிரம்பி, ஒரு தட்டலில் உறுதி.',
    vp_note:'6 இந்திய மொழிகளைப் புரிந்துகொள்கிறது — இந்தியா பேசும் விதத்திற்காக உருவான குரல் பதிவு.',
    vp_pos:'POS பதிவு', vp_qty:'அளவு', vp_pay:'பணம் செலுத்தல்', vp_amt:'தொகை', vp_50l:'50 லிட்டர்',
    gf_title:'POS உங்கள் பங்கின் வாசலுக்குள் மட்டுமே வேலை செய்யும்.',
    gf_sub:'100m முதல் 2km வரை GPS ஜியோ-ஃபென்ஸ். எல்லைக்கு வெளியே POS தானே பூட்டிக்கொள்கிறது. யாரையாவது நீக்கினீர்களா? ஒரு தட்டலில் அவர்களின் அணுகல் முடிந்தது — எங்கிருந்தும்.',
    gf_inc:'எல்லா திட்டங்களிலும் உண்டு',
    cmp_sub:'மற்றவை பங்குகளை பாதியில் விடுகின்றன. Pumpini ஒவ்வொரு துளிக்கும் — ஒவ்வொரு ரூபாய்க்கும் — கணக்கு வைக்கிறது. அடிப்படைகளில் சமம், பிறகு பழைய மென்பொருள் போக முடியாத இடத்திற்கு.',
    cmp_feature:'அம்சம்', cmp_others:'மற்றவை',
    cmp_legend:'✅ உண்டு · ⚠️ சில விற்பனையாளர்களில் மட்டும் · ❌ இல்லை',
    cmp_rows:['பில்லிங் & GST இன்வாய்ஸ்','ஷிப்ட் & பண சரிபார்ப்பு','டேங்க் ஸ்டாக் & நாஸில் ரீடிங்','கடன் / கார்ப்பரேட் வாடிக்கையாளர்கள்','கிளவுட் + மொபைல் ஆப்','உடனடி இன்-ஆப் எச்சரிக்கைகள்','இந்திய மொழிகளில் குரல் POS','6 இந்திய மொழிகளில் முழு ஆப்','GPS ஜியோ-ஃபென்சிங் பாதுகாப்பு','பிளைண்ட்-டிராப் பணக் கட்டுப்பாடு','AI உதவியாளர் — உங்கள் தரவிடம் கேளுங்கள்','நிகழ்நேர நேரடி டாஷ்போர்டு'],
    pr_pop:'மிகவும் பிரபலம்', pr_cta:'இலவச சோதனை தொடங்கு',
    pr_foot:'உங்கள் பங்க் கவுண்டர் வழியாக தினமும் லட்சங்கள் செல்கின்றன — நாளொன்றுக்கு ஒரு லிட்டர் பெட்ரோலுக்கும் குறைவான செலவில் அதைப் பாதுகாக்கவும்.',
    pr_more:'மேலும் பங்க்கள் வேண்டுமா? தொடர்பு கொள்ளுங்கள் →',
    plan_starter:{tag:'ஒவ்வொரு துளி & ரூபாய் கட்டுப்பாடு — ஒரு பங்க்', perday:'நாளுக்கு ₹20', note:'இரண்டு கப் டீ',
      feats:['1 பெட்ரோல் பங்க்','வரம்பற்ற நாஸில்கள் & டேங்குகள்','குரல் POS பதிவு · 6 இந்திய மொழிகள்','பிளைண்ட்-டிராப் ஷிப்ட் சரிபார்ப்பு','வெட்-ஸ்டாக் (டேங்க் டிப்) சரிபார்ப்பு','நேரடி டேங்க் வேறுபாடு எச்சரிக்கைகள்','பெட்டி கேஷ் + வங்கி டெபாசிட் கண்காணிப்பு','டிப்ஸ்டிக் & டெலிவரிகள்','நிகழ்நேர டாஷ்போர்டு & அறிக்கைகள்','ஜியோ-ஃபென்சிங் பாதுகாப்பு']},
    plan_pro:{tag:'முழு வணிகத்தையும் நடத்துங்கள் — ஒரு பங்க்', perday:'நாளுக்கு ₹33', note:'⅓ லிட்டர் பெட்ரோல்',
      feats:['ஸ்டார்ட்டரில் உள்ள அனைத்தும்','கடன் வாடிக்கையாளர்கள் & GST இன்வாய்ஸ்','கடன் ரசீதுகள் & நோட்டுகள்','லூப்ஸ் & பொருட்கள் (பார்கோடு)','பண நேர்மை கண்காணிப்பு','Tally Prime ஏற்றுமதி','AI உதவியாளர்']},
    plan_ent:{tag:'பங்குகளின் குழுவிற்கு', perday:'நாளுக்கு ₹66', note:'5 பங்க்கள் வரை',
      feats:['ப்ரோவில் உள்ள அனைத்தும்','5 பெட்ரோல் பங்க் வரை','குழு டாஷ்போர்டு','மல்டி-ஸ்டேஷன் அறிக்கைகள்','கார்ப்பரேட் PAN ஃபிளீட் போர்டல்','முன்னுரிமை ஆதரவு']},
    ct_title:'தொடர்பு கொள்ளுங்கள் — உங்கள் இலவச சோதனையை அமைத்துத் தருகிறோம்',
    ct_sub:'உங்கள் விவரங்களை விடுங்கள், 15-நாள் இலவச சோதனையை செயல்படுத்த எங்கள் குழு உங்களைத் தொடர்பு கொள்ளும். கார்டு இல்லை, கட்டாயம் இல்லை — உங்கள் பங்க், உங்கள் கட்டுப்பாட்டில்.',
    ct_bunk:'பெட்ரோல் பங்க் பெயர்', ct_name:'உங்கள் பெயர் *', ct_phone:'மொபைல் எண் *',
    ct_state:'மாநிலம்', ct_city:'நகரம்', ct_cityfirst:'முதலில் மாநிலம் தேர்வு செய்யவும்',
    ct_msg:'வேறு ஏதேனும் சொல்ல விரும்புகிறீர்களா? (விருப்பம்)',
    ct_err:'ஏதோ தவறு நடந்தது. சிறிது நேரத்தில் மீண்டும் முயற்சிக்கவும்.',
    ct_send:'தொடர்பு கொள்ளுங்கள்', ct_sending:'அனுப்பப்படுகிறது…',
    ct_note:'15 நாள் இலவச சோதனை · கிரெடிட் கார்டு இல்லை · ஸ்பேம் இல்லை.',
    ct_thanks:'நன்றி!', ct_thanks_sub:'உங்கள் விவரங்கள் கிடைத்தன. இலவச சோதனையை அமைக்க விரைவில் தொடர்பு கொள்கிறோம்.',
  },
  te: {
    hero:    'ప్రతి చుక్కను నియంత్రించండి.',
    hero2:   'ప్రతి రూపాయిని ట్రాక్ చేయండి.',
    sub:     'మీ కౌంటర్ గుండా రోజూ లక్షలు కదులుతాయి. Pumpini అంటే నిద్రపోని యజమాని లెక్కల పుస్తకం — ప్రతి నాజిల్, ప్రతి షిఫ్ట్, ప్రతి రూపాయికి లెక్క, మీ భాషలో.',
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
    nav_leak:'Pumpini AI', nav_features:'ఫీచర్లు', nav_pricing:'ధర', nav_contact:'సంప్రదించండి', login:'లాగిన్', home:'హోమ్',
    hero_badge:'మీ బంక్ కోసం AI కంట్రోల్ రూమ్',
    cta_leak:'మీ AI మేనేజర్‌ను కలవండి →',
    cards_t:'మీ స్నేహితుల బంకుల్లో లేని మూడు విషయాలు.',
    cards_sub:'వచ్చే డీలర్స్ మీటింగ్‌లో వీటితోనే మొదలుపెట్టండి.',
    c1_t:'అడగండి. జవాబు సిద్ధం.', c1_chip:'AI అసిస్టెంట్',
    c1_d:'“నిన్న ఎంత డీజిల్ అమ్ముడైంది? ఎవరి బాకీ ఎక్కువ?” మీ భాషలో అడగండి — Pumpini AI మీ బంక్ సొంత డేటా నుంచి జవాబిస్తుంది.',
    c2_t:'వెట్ & డ్రై. రెండూ కవర్.', c2_chip:'పూర్తి కవరేజ్',
    c2_d:'ట్యాంక్ డిప్, డెన్సిటీ, డెలివరీలు, నాజిల్ రీడింగ్‌లు — పైగా లూబ్స్, బార్‌కోడ్, GST స్టాక్ కూడా. మిగతా సాఫ్ట్‌వేర్ ఒక వైపే. Pumpini రెండూ నడుపుతుంది.',
    c3_t:'క్యాష్ నిజాయితీ లెక్క.', c3_chip:'హింట్ లేని క్యాష్ చెక్',
    c3_d:'స్టాఫ్ ముందుగా క్యాష్ లెక్కించి చెబుతారు — అప్పటివరకు రావాల్సిన మొత్తం కనిపించదు. “మ్యాచ్” చేయడానికి టార్గెట్ లేదు, జేబులో వేసుకునే దారి లేదు.',
    ai_badge:'PUMPINI AI', ai_lang:'6 భాషల్లోనూ',
    ai_old:'“ఈరోజు ఏం జరిగింది?”', ai_old_s:'మిగతా ప్రతి సాఫ్ట్‌వేర్',
    ai_new:'“రేపు ఏం జరుగుతుంది?”', ai_new_s:'Pumpini AI మాత్రమే',
    ai_title:'రిపోర్టులు జరిగింది చెబుతాయి. Pumpini జరగబోయేది చెబుతుంది.',
    ai_sub:'బంక్ నడిపే కొత్త పద్ధతి: నిన్నటి ముక్కలు అతికించడం ఆపండి — రేపును రాకముందే చూడండి.',
    ai_q:'వీకెండ్ ముందు ట్యాంకర్ కావాలా?',
    ai_a:'అవును — ఈ వారం వేగంతో ట్యాంక్ 1 శనివారం సాయంత్రానికి రిజర్వ్‌కు చేరుతుంది. సెలవు ట్రాఫిక్ ~9% పెంచుతుంది. శుక్రవారానికి ట్యాంకర్ బుక్ చేయండి.',
    ai_alerts_t:'రేపు నష్టం కాకముందే — ఈరోజే పట్టుబడింది:',
    ai_al1:'⛽ ట్యాంక్ 2 వేరియన్స్ పెరుగుతోంది — ఇదే వేగంతో ఈ నెల ~700 L నష్టం. మంగళవారం నైట్ షిఫ్ట్ ఇప్పుడే చూడండి.',
    ai_al2:'💸 ఒక అటెండెంట్ షిఫ్టుల్లో క్యాష్ మళ్లీ మళ్లీ తక్కువ — అదే ₹300–500. తర్వాతిది ఊహించదగినదే. ఈ రాత్రి గమనించండి.',
    ai_al3:'🧾 ఒక క్రెడిట్ కస్టమర్ చెల్లింపులు నెమ్మది చేస్తూ ఎక్కువ నింపుతున్నారు — ప్యాటర్న్ కొనసాగితే ₹1.9 లక్షలు రిస్క్. తదుపరి ఫిల్లింగ్ ముందు ఫోన్ చేయండి.',
    ai_note:'ఆవిరి, స్టాక్ నష్టం, క్యాష్ కొరత, క్రెడిట్ రిస్క్ — Pumpini AI ప్యాటర్న్ చదివి సమయానికి హెచ్చరిస్తుంది, పోస్ట్‌మార్టమ్‌లో కాదు.',
    ez_title:'వాడటం సులభం. అన్నీ కవర్.',
    ez_sub:'మిగతావి ఒకటే ఎంచుకోమంటాయి. Pumpini ఒప్పుకోదు.',
    ez_x:'సులభం →', ez_y:'↑ ఎక్కువ కవరేజ్',
    ez_d1:'పాత డెస్క్‌టాప్ సాఫ్ట్‌వేర్', ez_d2:'సింపుల్ బిల్లింగ్ యాప్‌లు', ez_d3:'డైరీ & రిజిస్టర్లు',
    ez_we_sub:'AI + వాయిస్ + పూర్తి కవరేజ్',
    hb1:'6 భాషల్లో వాయిస్', hb2:'లోపలే AI అసిస్టెంట్', hb3:'GPS-లాక్డ్ POS',
    ph_title:'ఈరోజు మీ బంక్‌లో', ph_sub:'యజమాని మాత్రమే చూసేది', ph_live:'లైవ్',
    ph_sales:'ఇప్పటివరకు అమ్మకాలు', ph_fills:'2,389 లీటర్లు · 318 ఫిల్స్',
    ph_cash:'నగదు', ph_credit:'క్రెడిట్',
    ph_shift:'షిఫ్ట్ 2 — ఓపెన్', ph_hidden:'సిబ్బందికి: షిఫ్ట్ ముగిసే వరకు మొత్తం కనిపించదు',
    ph_tank:'ట్యాంక్ వేరియన్స్:', ph_tankok:'−34 L · పరిమితిలో',
    ph_deposit:'₹1,42,000 డిపాజిట్ కాలేదు — 2 రోజులు', ph_alert:'అలర్ట్',
    ph_note:'పైన ఉన్న ప్రతి సంఖ్య లైవ్‌గా అప్‌డేట్ అవుతుంది — మీ భాషలో, మీ ఫోన్‌లో.',
    permo:'/నెల',
    bd_badge:'PUMPINIలో మాత్రమే — నిజాయితీ క్యాష్ లెక్క',
    bd_title:'మోసం చేయలేని కౌంటర్.',
    bd_sub:'చాలా బంకుల్లో, డ్రాయర్‌లో ఎంత నగదు ఉండాలో అటెండర్‌కు కచ్చితంగా తెలుసు — అందుకే డ్రాయర్ ఎప్పుడూ “సరిపోతుంది”. Pumpini ఆటనే మార్చేస్తుంది.',
    bd_wo:'PUMPINI లేకుండా', bd_w:'PUMPINI తో',
    bd_wo1:'లెక్కించే ముందే అటెండర్ రావాల్సిన మొత్తాన్ని చూస్తాడు',
    bd_wo2:'రౌండ్-ఆఫ్ ఉంచుకుంటాడు, చిల్లర తగ్గిస్తాడు, తేడా జేబులో',
    bd_wo3:'డ్రాయర్ ప్రతిరోజూ “ఖచ్చితంగా సరిపోతుంది”',
    bd_wo4:'మీకు అనుమానం వస్తుంది, కానీ నిరూపించలేరు',
    bd_w1:'షిఫ్ట్ ఓపెన్‌గా ఉన్నంతవరకు అమ్మకాల మొత్తం దాగి ఉంటుంది — మేనేజర్‌కు కూడా',
    bd_w2:'అటెండర్ ముందుగా తన నగదును ప్రకటిస్తాడు, తర్వాత సిస్టమ్ నిజం చూపిస్తుంది',
    bd_w3:'ప్రతి షార్ట్‌ఫాల్ రికార్డ్ — పేరు, షిఫ్ట్, మొత్తం, ధోరణి',
    bd_w4:'నిజాయితీ సిబ్బందికి భరోసా. మిగతా రకం వాళ్లే వెళ్లిపోతారు.',
    bd_close:'ఓపెన్ షిఫ్ట్ అమ్మకాలు ఓనర్ మాత్రమే చూస్తారు. మేనేజర్ కాదు. షిఫ్ట్ లీడ్ కాదు.', bd_you:'మీరే.',
    vp_badge:'వాయిస్ POS', vp_pre:'మీ అటెండర్ ', vp_hl:'చెబితే చాలు', vp_post:'. Pumpini రాసేసుకుంటుంది.',
    vp_sub:'టైపింగ్ లేదు, ట్రైనింగ్ లేదు, సాకులు లేవు. మైక్ నొక్కి తెలుగు, తమిళం, హిందీ — ఏ భారతీయ భాషలోనైనా మాట్లాడతాడు. ఎంట్రీ దానంతట అదే నిండి, ఒక్క ట్యాప్‌తో కన్ఫర్మ్.',
    vp_note:'6 భారతీయ భాషలను అర్థం చేసుకుంటుంది — భారతదేశం మాట్లాడే తీరుకు తగ్గ వాయిస్ ఎంట్రీ.',
    vp_pos:'POS ఎంట్రీ', vp_qty:'పరిమాణం', vp_pay:'చెల్లింపు', vp_amt:'మొత్తం', vp_50l:'50 లీటర్లు',
    gf_title:'POS మీ బంక్ గేటు లోపల మాత్రమే పనిచేస్తుంది.',
    gf_sub:'100m నుండి 2km వరకు GPS జియో-ఫెన్స్. సరిహద్దు బయట POS దానంతట అదే లాక్ అవుతుంది. ఎవరినైనా తీసేశారా? ఒక్క ట్యాప్‌తో వారి యాక్సెస్ పోతుంది — ఎక్కడి నుండైనా.',
    gf_inc:'ప్రతి ప్లాన్‌లో ఉంది',
    cmp_sub:'ఇతరులు బంకులను సగంలో వదిలేస్తారు. Pumpini ప్రతి చుక్కకూ — ప్రతి రూపాయికీ — లెక్క ఉంచుతుంది. బేసిక్స్‌లో సమానం, తర్వాత పాత సాఫ్ట్‌వేర్ వెళ్లలేని చోటికి.',
    cmp_feature:'ఫీచర్', cmp_others:'ఇతరులు',
    cmp_legend:'✅ ఉంది · ⚠️ కొందరి వద్ద మాత్రమే / బేసిక్ వెర్షన్ · ❌ లేదు',
    cmp_rows:['బిల్లింగ్ & GST ఇన్వాయిస్‌లు','షిఫ్ట్ & క్యాష్ సరిచూపు','ట్యాంక్ స్టాక్ & నాజిల్ రీడింగ్‌లు','క్రెడిట్ / కార్పొరేట్ కస్టమర్లు','క్లౌడ్ + మొబైల్ యాప్','తక్షణ ఇన్-యాప్ అలర్ట్‌లు','భారతీయ భాషల్లో వాయిస్ POS','6 భారతీయ భాషల్లో పూర్తి యాప్','GPS జియో-ఫెన్సింగ్ భద్రత','బ్లైండ్-డ్రాప్ క్యాష్ కంట్రోల్','AI అసిస్టెంట్ — మీ డేటాను అడగండి','రియల్-టైమ్ లైవ్ డాష్‌బోర్డ్'],
    pr_pop:'అత్యంత ప్రజాదరణ', pr_cta:'ఉచిత ట్రయల్ ప్రారంభించండి',
    pr_foot:'మీ బంక్ కౌంటర్ గుండా రోజూ లక్షలు వెళ్తాయి — రోజుకు ఒక లీటరు పెట్రోల్ కంటే తక్కువ ఖర్చుతో దాన్ని కాపాడుకోండి.',
    pr_more:'మరిన్ని బంకులు కావాలా? సంప్రదించండి →',
    plan_starter:{tag:'ప్రతి చుక్క & రూపాయి నియంత్రణ — ఒక బంక్', perday:'రోజుకు ₹20', note:'రెండు కప్పుల చాయ్',
      feats:['1 పెట్రోల్ బంక్','అపరిమిత నాజిల్స్ & ట్యాంకులు','వాయిస్ POS ఎంట్రీ · 6 భారతీయ భాషలు','బ్లైండ్-డ్రాప్ షిఫ్ట్ సరిచూపు','వెట్-స్టాక్ (ట్యాంక్ డిప్) సరిచూపు','లైవ్ ట్యాంక్ వేరియన్స్ అలర్ట్‌లు','పెట్టీ క్యాష్ + బ్యాంక్ డిపాజిట్ ట్రాకింగ్','డిప్‌స్టిక్ & డెలివరీలు','రియల్-టైమ్ డాష్‌బోర్డ్ & రిపోర్టులు','జియో-ఫెన్సింగ్ భద్రత']},
    plan_pro:{tag:'పూర్తి వ్యాపారం నడపండి — ఒక బంక్', perday:'రోజుకు ₹33', note:'⅓ లీటరు పెట్రోల్',
      feats:['స్టార్టర్‌లోని అన్నీ','క్రెడిట్ కస్టమర్లు & GST ఇన్వాయిస్‌లు','క్రెడిట్ రసీదులు & నోట్లు','లూబ్స్ & ప్రొడక్ట్స్ (బార్‌కోడ్)','క్యాష్ ఇంటెగ్రిటీ పర్యవేక్షణ','Tally Prime ఎగుమతి','AI అసిస్టెంట్']},
    plan_ent:{tag:'బంకుల గ్రూపు కోసం', perday:'రోజుకు ₹66', note:'5 బంకుల వరకు',
      feats:['ప్రోలోని అన్నీ','5 పెట్రోల్ బంకుల వరకు','గ్రూప్ డాష్‌బోర్డ్','మల్టీ-స్టేషన్ రిపోర్టులు','కార్పొరేట్ PAN ఫ్లీట్ పోర్టల్','ప్రాధాన్య సపోర్ట్']},
    ct_title:'సంప్రదించండి — మీ ఉచిత ట్రయల్ మేము సెటప్ చేస్తాం',
    ct_sub:'మీ వివరాలు ఇవ్వండి, 15-రోజుల ఉచిత ట్రయల్ యాక్టివేట్ చేయడానికి మా టీమ్ మిమ్మల్ని సంప్రదిస్తుంది. కార్డ్ లేదు, కట్టుబాటు లేదు — మీ బంక్, మీ నియంత్రణలో.',
    ct_bunk:'పెట్రోల్ బంక్ పేరు', ct_name:'మీ పేరు *', ct_phone:'మొబైల్ నంబర్ *',
    ct_state:'రాష్ట్రం', ct_city:'నగరం', ct_cityfirst:'ముందుగా రాష్ట్రం ఎంచుకోండి',
    ct_msg:'మాకు ఏదైనా చెప్పాలనుకుంటున్నారా? (ఐచ్ఛికం)',
    ct_err:'ఏదో తప్పు జరిగింది. కాసేపటి తర్వాత మళ్లీ ప్రయత్నించండి.',
    ct_send:'సంప్రదించండి', ct_sending:'పంపుతున్నాం…',
    ct_note:'15 రోజుల ఉచిత ట్రయల్ · క్రెడిట్ కార్డ్ అవసరం లేదు · స్పామ్ ఉండదు.',
    ct_thanks:'ధన్యవాదాలు!', ct_thanks_sub:'మీ వివరాలు అందాయి. ఉచిత ట్రయల్ సెటప్ చేయడానికి త్వరలో సంప్రదిస్తాం.',
  },
  kn: {
    hero:    'ಪ್ರತಿ ಹನಿಯನ್ನು ನಿಯಂತ್ರಿಸಿ.',
    hero2:   'ಪ್ರತಿ ರೂಪಾಯಿಯನ್ನು ಟ್ರ್ಯಾಕ್ ಮಾಡಿ.',
    sub:     'ನಿಮ್ಮ ಕೌಂಟರ್ ಮೂಲಕ ದಿನವೂ ಲಕ್ಷಗಳು ಹರಿಯುತ್ತವೆ. Pumpini ಎಂದರೆ ನಿದ್ರಿಸದ ಮಾಲೀಕರ ಲೆಕ್ಕದ ಪುಸ್ತಕ — ಪ್ರತಿ ನಾಜಲ್, ಪ್ರತಿ ಶಿಫ್ಟ್, ಪ್ರತಿ ರೂಪಾಯಿಗೆ ಲೆಕ್ಕ, ನಿಮ್ಮ ಭಾಷೆಯಲ್ಲಿ.',
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
    nav_leak:'Pumpini AI', nav_features:'ವೈಶಿಷ್ಟ್ಯಗಳು', nav_pricing:'ಬೆಲೆ', nav_contact:'ಸಂಪರ್ಕ', login:'ಲಾಗಿನ್', home:'ಮುಖಪುಟ',
    hero_badge:'ನಿಮ್ಮ ಬಂಕ್‌ಗೆ AI ಕಂಟ್ರೋಲ್ ರೂಮ್',
    cta_leak:'ನಿಮ್ಮ AI ಮ್ಯಾನೇಜರ್ ಭೇಟಿಯಾಗಿ →',
    cards_t:'ನಿಮ್ಮ ಸ್ನೇಹಿತರ ಬಂಕ್‌ಗಳಲ್ಲಿ ಇಲ್ಲದ ಮೂರು ವಿಷಯಗಳು.',
    cards_sub:'ಮುಂದಿನ ಡೀಲರ್ಸ್ ಮೀಟಿಂಗ್‌ನಲ್ಲಿ ಇವುಗಳಿಂದಲೇ ಶುರು ಮಾಡಿ.',
    c1_t:'ಕೇಳಿ. ಉತ್ತರ ಸಿದ್ಧ.', c1_chip:'AI ಸಹಾಯಕ',
    c1_d:'“ನಿನ್ನೆ ಎಷ್ಟು ಡೀಸೆಲ್ ಮಾರಾಟವಾಯಿತು? ಯಾರ ಬಾಕಿ ಹೆಚ್ಚು?” ನಿಮ್ಮ ಭಾಷೆಯಲ್ಲಿ ಕೇಳಿ — Pumpini AI ನಿಮ್ಮ ಬಂಕ್‌ನ ಸ್ವಂತ ಡೇಟಾದಿಂದ ಉತ್ತರಿಸುತ್ತದೆ.',
    c2_t:'ವೆಟ್ & ಡ್ರೈ. ಎರಡೂ ಕವರ್.', c2_chip:'ಪೂರ್ಣ ಕವರೇಜ್',
    c2_d:'ಟ್ಯಾಂಕ್ ಡಿಪ್, ಸಾಂದ್ರತೆ, ಡೆಲಿವರಿ, ನಾಜಲ್ ರೀಡಿಂಗ್ — ಜೊತೆಗೆ ಲೂಬ್ಸ್, ಬಾರ್‌ಕೋಡ್, GST ಸ್ಟಾಕ್ ಕೂಡ. ಉಳಿದ ಸಾಫ್ಟ್‌ವೇರ್ ಒಂದು ಕಡೆ ಮಾತ್ರ. Pumpini ಎರಡನ್ನೂ ನಡೆಸುತ್ತದೆ.',
    c3_t:'ಕ್ಯಾಶ್ ಪ್ರಾಮಾಣಿಕ ಲೆಕ್ಕ.', c3_chip:'ಹಿಂಟ್ ಇಲ್ಲದ ಕ್ಯಾಶ್ ಚೆಕ್',
    c3_d:'ಸ್ಟಾಫ್ ಮೊದಲು ಕ್ಯಾಶ್ ಎಣಿಸಿ ಘೋಷಿಸುತ್ತಾರೆ — ಅಲ್ಲಿಯವರೆಗೆ ನಿರೀಕ್ಷಿತ ಮೊತ್ತ ಮರೆಯಾಗಿರುತ್ತದೆ. “ಮ್ಯಾಚ್” ಮಾಡಲು ಟಾರ್ಗೆಟ್ ಇಲ್ಲ, ಜೇಬಿಗೆ ಹಾಕುವ ದಾರಿ ಇಲ್ಲ.',
    ai_badge:'PUMPINI AI', ai_lang:'ಎಲ್ಲ 6 ಭಾಷೆಗಳಲ್ಲೂ',
    ai_old:'“ಇಂದು ಏನಾಯಿತು?”', ai_old_s:'ಉಳಿದ ಎಲ್ಲ ಸಾಫ್ಟ್‌ವೇರ್',
    ai_new:'“ನಾಳೆ ಏನಾಗುತ್ತದೆ?”', ai_new_s:'Pumpini AI ಮಾತ್ರ',
    ai_title:'ರಿಪೋರ್ಟ್‌ಗಳು ಆದದ್ದನ್ನು ಹೇಳುತ್ತವೆ. Pumpini ಆಗಲಿರುವುದನ್ನು ಹೇಳುತ್ತದೆ.',
    ai_sub:'ಬಂಕ್ ನಡೆಸುವ ಹೊಸ ದಾರಿ: ನಿನ್ನೆಯ ತುಣುಕುಗಳನ್ನು ಜೋಡಿಸುವುದನ್ನು ನಿಲ್ಲಿಸಿ — ನಾಳೆಯನ್ನು ಬರುವ ಮೊದಲೇ ನೋಡಿ.',
    ai_q:'ವೀಕೆಂಡ್ ಮೊದಲು ಟ್ಯಾಂಕರ್ ಬೇಕೇ?',
    ai_a:'ಹೌದು — ಈ ವಾರದ ವೇಗದಲ್ಲಿ ಟ್ಯಾಂಕ್ 1 ಶನಿವಾರ ಸಂಜೆಗೆ ರಿಸರ್ವ್ ತಲುಪುತ್ತದೆ. ರಜೆಯ ಟ್ರಾಫಿಕ್ ~9% ಸೇರಿಸುತ್ತದೆ. ಶುಕ್ರವಾರಕ್ಕೆ ಟ್ಯಾಂಕರ್ ಬುಕ್ ಮಾಡಿ.',
    ai_alerts_t:'ನಾಳೆ ನಷ್ಟವಾಗುವ ಮೊದಲು — ಇಂದೇ ಸಿಕ್ಕಿಬಿದ್ದದ್ದು:',
    ai_al1:'⛽ ಟ್ಯಾಂಕ್ 2 ವೇರಿಯನ್ಸ್ ಏರುತ್ತಿದೆ — ಇದೇ ವೇಗದಲ್ಲಿ ಈ ತಿಂಗಳು ~700 L ನಷ್ಟ. ಮಂಗಳವಾರದ ನೈಟ್ ಶಿಫ್ಟ್ ಈಗಲೇ ಪರಿಶೀಲಿಸಿ.',
    ai_al2:'💸 ಒಬ್ಬ ಅಟೆಂಡೆಂಟ್ ಶಿಫ್ಟ್‌ಗಳಲ್ಲಿ ಕ್ಯಾಶ್ ಮತ್ತೆ ಮತ್ತೆ ಕಡಿಮೆ — ಅದೇ ₹300–500. ಮುಂದಿನದು ಊಹಿಸಬಹುದು. ಇಂದು ರಾತ್ರಿ ಗಮನಿಸಿ.',
    ai_al3:'🧾 ಒಬ್ಬ ಕ್ರೆಡಿಟ್ ಗ್ರಾಹಕ ಪಾವತಿ ನಿಧಾನ ಮಾಡುತ್ತಾ ಹೆಚ್ಚು ತುಂಬಿಸುತ್ತಿದ್ದಾರೆ — ಪ್ಯಾಟರ್ನ್ ಮುಂದುವರಿದರೆ ₹1.9 ಲಕ್ಷ ರಿಸ್ಕ್. ಮುಂದಿನ ಫಿಲ್ಲಿಂಗ್ ಮೊದಲು ಕರೆ ಮಾಡಿ.',
    ai_note:'ಆವಿಯಾಗುವಿಕೆ, ಸ್ಟಾಕ್ ನಷ್ಟ, ಕ್ಯಾಶ್ ಕೊರತೆ, ಕ್ರೆಡಿಟ್ ರಿಸ್ಕ್ — Pumpini AI ಪ್ಯಾಟರ್ನ್ ಓದಿ ಸಮಯಕ್ಕೆ ಸರಿಯಾಗಿ ಎಚ್ಚರಿಸುತ್ತದೆ, ಪೋಸ್ಟ್‌ಮಾರ್ಟಂನಲ್ಲಿ ಅಲ್ಲ.',
    ez_title:'ಬಳಸಲು ಸುಲಭ. ಎಲ್ಲವೂ ಕವರ್.',
    ez_sub:'ಉಳಿದವು ಒಂದನ್ನೇ ಆರಿಸಲು ಹೇಳುತ್ತವೆ. Pumpini ಒಪ್ಪುವುದಿಲ್ಲ.',
    ez_x:'ಸುಲಭ →', ez_y:'↑ ಹೆಚ್ಚು ಕವರೇಜ್',
    ez_d1:'ಹಳೆಯ ಡೆಸ್ಕ್‌ಟಾಪ್ ಸಾಫ್ಟ್‌ವೇರ್', ez_d2:'ಸಿಂಪಲ್ ಬಿಲ್ಲಿಂಗ್ ಆ್ಯಪ್‌ಗಳು', ez_d3:'ಡೈರಿ & ರಿಜಿಸ್ಟರ್',
    ez_we_sub:'AI + ಧ್ವನಿ + ಪೂರ್ಣ ಕವರೇಜ್',
    hb1:'6 ಭಾಷೆಗಳಲ್ಲಿ ಧ್ವನಿ', hb2:'ಒಳಗೇ AI ಸಹಾಯಕ', hb3:'GPS-ಲಾಕ್ POS',
    ph_title:'ಇಂದು ನಿಮ್ಮ ಬಂಕ್‌ನಲ್ಲಿ', ph_sub:'ಮಾಲೀಕರು ಮಾತ್ರ ನೋಡುವುದು', ph_live:'ಲೈವ್',
    ph_sales:'ಇಲ್ಲಿಯವರೆಗಿನ ಮಾರಾಟ', ph_fills:'2,389 ಲೀಟರ್ · 318 ಭರ್ತಿ',
    ph_cash:'ನಗದು', ph_credit:'ಕ್ರೆಡಿಟ್',
    ph_shift:'ಶಿಫ್ಟ್ 2 — ತೆರೆದಿದೆ', ph_hidden:'ಸಿಬ್ಬಂದಿಗೆ: ಶಿಫ್ಟ್ ಮುಗಿಯುವವರೆಗೆ ಮೊತ್ತ ಮರೆಯಾಗಿರುತ್ತದೆ',
    ph_tank:'ಟ್ಯಾಂಕ್ ವ್ಯತ್ಯಾಸ:', ph_tankok:'−34 L · ಮಿತಿಯೊಳಗೆ',
    ph_deposit:'₹1,42,000 ಠೇವಣಿ ಆಗಿಲ್ಲ — 2 ದಿನ', ph_alert:'ಎಚ್ಚರಿಕೆ',
    ph_note:'ಮೇಲಿನ ಪ್ರತಿ ಸಂಖ್ಯೆ ಲೈವ್ ಆಗಿ ಅಪ್‌ಡೇಟ್ ಆಗುತ್ತದೆ — ನಿಮ್ಮ ಭಾಷೆಯಲ್ಲಿ, ನಿಮ್ಮ ಫೋನ್‌ನಲ್ಲಿ.',
    permo:'/ತಿಂಗಳು',
    bd_badge:'PUMPINIಯಲ್ಲಿ ಮಾತ್ರ — ಪ್ರಾಮಾಣಿಕ ಕ್ಯಾಶ್ ಲೆಕ್ಕ',
    bd_title:'ಮೋಸ ಮಾಡಲಾಗದ ಕೌಂಟರ್.',
    bd_sub:'ಹೆಚ್ಚಿನ ಬಂಕ್‌ಗಳಲ್ಲಿ, ಡ್ರಾಯರ್‌ನಲ್ಲಿ ಎಷ್ಟು ನಗದು ಇರಬೇಕು ಎಂದು ಸಿಬ್ಬಂದಿಗೆ ನಿಖರವಾಗಿ ಗೊತ್ತು — ಹಾಗಾಗಿ ಡ್ರಾಯರ್ ಯಾವಾಗಲೂ “ಸರಿಹೊಂದುತ್ತದೆ”. Pumpini ಆಟವನ್ನೇ ಬದಲಾಯಿಸುತ್ತದೆ.',
    bd_wo:'PUMPINI ಇಲ್ಲದೆ', bd_w:'PUMPINI ಜೊತೆ',
    bd_wo1:'ಎಣಿಸುವ ಮೊದಲೇ ಸಿಬ್ಬಂದಿ ನಿರೀಕ್ಷಿತ ಮೊತ್ತವನ್ನು ನೋಡುತ್ತಾನೆ',
    bd_wo2:'ರೌಂಡ್-ಆಫ್ ಇಟ್ಟುಕೊಳ್ಳುತ್ತಾನೆ, ಚಿಲ್ಲರೆ ಕಡಿಮೆ ಕೊಡುತ್ತಾನೆ, ವ್ಯತ್ಯಾಸ ಜೇಬಿಗೆ',
    bd_wo3:'ಡ್ರಾಯರ್ ಪ್ರತಿದಿನ “ಸರಿಯಾಗಿ ಹೊಂದುತ್ತದೆ”',
    bd_wo4:'ನಿಮಗೆ ಅನುಮಾನ ಬರುತ್ತದೆ, ಆದರೆ ಸಾಬೀತುಪಡಿಸಲು ಆಗುವುದಿಲ್ಲ',
    bd_w1:'ಶಿಫ್ಟ್ ತೆರೆದಿರುವವರೆಗೆ ಮಾರಾಟ ಮೊತ್ತ ಮರೆಯಾಗಿರುತ್ತದೆ — ಮ್ಯಾನೇಜರ್‌ಗೂ ಸಹ',
    bd_w2:'ಸಿಬ್ಬಂದಿ ಮೊದಲು ತನ್ನ ನಗದನ್ನು ಘೋಷಿಸುತ್ತಾನೆ, ನಂತರ ಸಿಸ್ಟಂ ಸತ್ಯ ತೋರಿಸುತ್ತದೆ',
    bd_w3:'ಪ್ರತಿ ಕೊರತೆಯೂ ದಾಖಲೆ — ಹೆಸರು, ಶಿಫ್ಟ್, ಮೊತ್ತ, ಮಾದರಿ',
    bd_w4:'ಪ್ರಾಮಾಣಿಕ ಸಿಬ್ಬಂದಿಗೆ ಧೈರ್ಯ. ಇನ್ನೊಂದು ಬಗೆಯವರು ತಾವೇ ಬಿಟ್ಟು ಹೋಗುತ್ತಾರೆ.',
    bd_close:'ತೆರೆದ ಶಿಫ್ಟ್ ಮಾರಾಟವನ್ನು ಮಾಲೀಕರು ಮಾತ್ರ ನೋಡುತ್ತಾರೆ. ಮ್ಯಾನೇಜರ್ ಅಲ್ಲ. ಶಿಫ್ಟ್ ಮುಖ್ಯಸ್ಥ ಅಲ್ಲ.', bd_you:'ನೀವು ಮಾತ್ರ.',
    vp_badge:'ಧ್ವನಿ POS', vp_pre:'ನಿಮ್ಮ ಸಿಬ್ಬಂದಿ ', vp_hl:'ಹೇಳಿದರೆ ಸಾಕು', vp_post:'. Pumpini ಬರೆದುಕೊಳ್ಳುತ್ತದೆ.',
    vp_sub:'ಟೈಪಿಂಗ್ ಇಲ್ಲ, ತರಬೇತಿ ಇಲ್ಲ, ನೆಪವಿಲ್ಲ. ಮೈಕ್ ಒತ್ತಿ ಕನ್ನಡ, ತೆಲುಗು, ಹಿಂದಿ — ಯಾವುದೇ ಭಾರತೀಯ ಭಾಷೆಯಲ್ಲಿ ಮಾತನಾಡುತ್ತಾನೆ. ಎಂಟ್ರಿ ತಾನಾಗಿಯೇ ತುಂಬಿ, ಒಂದು ಟ್ಯಾಪ್‌ನಲ್ಲಿ ದೃಢೀಕರಣ.',
    vp_note:'6 ಭಾರತೀಯ ಭಾಷೆಗಳನ್ನು ಅರ್ಥಮಾಡಿಕೊಳ್ಳುತ್ತದೆ — ಭಾರತ ಮಾತನಾಡುವ ರೀತಿಗೆ ರೂಪುಗೊಂಡ ಧ್ವನಿ ಎಂಟ್ರಿ.',
    vp_pos:'POS ಎಂಟ್ರಿ', vp_qty:'ಪ್ರಮಾಣ', vp_pay:'ಪಾವತಿ', vp_amt:'ಮೊತ್ತ', vp_50l:'50 ಲೀಟರ್',
    gf_title:'POS ನಿಮ್ಮ ಬಂಕ್ ಗೇಟ್ ಒಳಗೆ ಮಾತ್ರ ಕೆಲಸ ಮಾಡುತ್ತದೆ.',
    gf_sub:'100m ನಿಂದ 2km ವರೆಗೆ GPS ಜಿಯೋ-ಫೆನ್ಸ್. ಗಡಿಯ ಹೊರಗೆ POS ತಾನಾಗಿಯೇ ಲಾಕ್ ಆಗುತ್ತದೆ. ಯಾರನ್ನಾದರೂ ತೆಗೆದುಹಾಕಿದಿರಾ? ಒಂದು ಟ್ಯಾಪ್ — ಅವರ ಪ್ರವೇಶ ಹೋಯಿತು, ಎಲ್ಲಿಂದಲಾದರೂ.',
    gf_inc:'ಪ್ರತಿ ಪ್ಲಾನ್‌ನಲ್ಲೂ ಇದೆ',
    cmp_sub:'ಇತರರು ಬಂಕ್‌ಗಳನ್ನು ಅರ್ಧದಲ್ಲಿ ಬಿಡುತ್ತಾರೆ. Pumpini ಪ್ರತಿ ಹನಿಗೂ — ಪ್ರತಿ ರೂಪಾಯಿಗೂ — ಲೆಕ್ಕ ಇಡುತ್ತದೆ. ಮೂಲಭೂತದಲ್ಲಿ ಸಮ, ನಂತರ ಹಳೆಯ ಸಾಫ್ಟ್‌ವೇರ್ ಹೋಗಲಾಗದ ಕಡೆಗೆ.',
    cmp_feature:'ವೈಶಿಷ್ಟ್ಯ', cmp_others:'ಇತರರು',
    cmp_legend:'✅ ಇದೆ · ⚠️ ಕೆಲವರಲ್ಲಿ ಮಾತ್ರ / ಬೇಸಿಕ್ ಆವೃತ್ತಿ · ❌ ಇಲ್ಲ',
    cmp_rows:['ಬಿಲ್ಲಿಂಗ್ & GST ಇನ್‌ವಾಯ್ಸ್','ಶಿಫ್ಟ್ & ನಗದು ಹೊಂದಾಣಿಕೆ','ಟ್ಯಾಂಕ್ ಸ್ಟಾಕ್ & ನಾಜಲ್ ರೀಡಿಂಗ್','ಕ್ರೆಡಿಟ್ / ಕಾರ್ಪೊರೇಟ್ ಗ್ರಾಹಕರು','ಕ್ಲೌಡ್ + ಮೊಬೈಲ್ ಆ್ಯಪ್','ತಕ್ಷಣದ ಇನ್-ಆ್ಯಪ್ ಎಚ್ಚರಿಕೆಗಳು','ಭಾರತೀಯ ಭಾಷೆಗಳಲ್ಲಿ ಧ್ವನಿ POS','6 ಭಾರತೀಯ ಭಾಷೆಗಳಲ್ಲಿ ಪೂರ್ಣ ಆ್ಯಪ್','GPS ಜಿಯೋ-ಫೆನ್ಸಿಂಗ್ ಭದ್ರತೆ','ಬ್ಲೈಂಡ್-ಡ್ರಾಪ್ ನಗದು ನಿಯಂತ್ರಣ','AI ಸಹಾಯಕ — ನಿಮ್ಮ ಡೇಟಾ ಕೇಳಿ','ರಿಯಲ್-ಟೈಮ್ ಲೈವ್ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್'],
    pr_pop:'ಅತಿ ಜನಪ್ರಿಯ', pr_cta:'ಉಚಿತ ಟ್ರಯಲ್ ಪ್ರಾರಂಭಿಸಿ',
    pr_foot:'ನಿಮ್ಮ ಬಂಕ್ ಕೌಂಟರ್ ಮೂಲಕ ಪ್ರತಿದಿನ ಲಕ್ಷಗಳು ಹಾದುಹೋಗುತ್ತವೆ — ದಿನಕ್ಕೆ ಒಂದು ಲೀಟರ್ ಪೆಟ್ರೋಲ್‌ಗಿಂತ ಕಡಿಮೆ ವೆಚ್ಚದಲ್ಲಿ ಅದನ್ನು ರಕ್ಷಿಸಿ.',
    pr_more:'ಹೆಚ್ಚು ಬಂಕ್ ಬೇಕೇ? ಸಂಪರ್ಕಿಸಿ →',
    plan_starter:{tag:'ಪ್ರತಿ ಹನಿ & ರೂಪಾಯಿ ನಿಯಂತ್ರಣ — ಒಂದು ಬಂಕ್', perday:'ದಿನಕ್ಕೆ ₹20', note:'ಎರಡು ಕಪ್ ಚಹಾ',
      feats:['1 ಪೆಟ್ರೋಲ್ ಬಂಕ್','ಮಿತಿಯಿಲ್ಲದ ನಾಜಲ್ & ಟ್ಯಾಂಕ್','ಧ್ವನಿ POS ಎಂಟ್ರಿ · 6 ಭಾರತೀಯ ಭಾಷೆಗಳು','ಬ್ಲೈಂಡ್-ಡ್ರಾಪ್ ಶಿಫ್ಟ್ ಹೊಂದಾಣಿಕೆ','ವೆಟ್-ಸ್ಟಾಕ್ (ಟ್ಯಾಂಕ್ ಡಿಪ್) ಹೊಂದಾಣಿಕೆ','ಲೈವ್ ಟ್ಯಾಂಕ್ ವ್ಯತ್ಯಾಸ ಎಚ್ಚರಿಕೆ','ಪೆಟಿ ಕ್ಯಾಶ್ + ಬ್ಯಾಂಕ್ ಠೇವಣಿ ಟ್ರ್ಯಾಕಿಂಗ್','ಡಿಪ್‌ಸ್ಟಿಕ್ & ಡೆಲಿವರಿಗಳು','ರಿಯಲ್-ಟೈಮ್ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್ & ವರದಿಗಳು','ಜಿಯೋ-ಫೆನ್ಸಿಂಗ್ ಭದ್ರತೆ']},
    plan_pro:{tag:'ಪೂರ್ಣ ವ್ಯವಹಾರ ನಡೆಸಿ — ಒಂದು ಬಂಕ್', perday:'ದಿನಕ್ಕೆ ₹33', note:'⅓ ಲೀಟರ್ ಪೆಟ್ರೋಲ್',
      feats:['ಸ್ಟಾರ್ಟರ್‌ನ ಎಲ್ಲವೂ','ಕ್ರೆಡಿಟ್ ಗ್ರಾಹಕರು & GST ಇನ್‌ವಾಯ್ಸ್','ಕ್ರೆಡಿಟ್ ರಸೀದಿ & ನೋಟ್ಸ್','ಲೂಬ್ಸ್ & ಉತ್ಪನ್ನಗಳು (ಬಾರ್‌ಕೋಡ್)','ನಗದು ಸಮಗ್ರತೆ ಮೇಲ್ವಿಚಾರಣೆ','Tally Prime ರಫ್ತು','AI ಸಹಾಯಕ']},
    plan_ent:{tag:'ಬಂಕ್‌ಗಳ ಗುಂಪಿಗೆ', perday:'ದಿನಕ್ಕೆ ₹66', note:'5 ಬಂಕ್‌ವರೆಗೆ',
      feats:['ಪ್ರೋನ ಎಲ್ಲವೂ','5 ಪೆಟ್ರೋಲ್ ಬಂಕ್‌ವರೆಗೆ','ಗ್ರೂಪ್ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್','ಮಲ್ಟಿ-ಸ್ಟೇಷನ್ ವರದಿಗಳು','ಕಾರ್ಪೊರೇಟ್ PAN ಫ್ಲೀಟ್ ಪೋರ್ಟಲ್','ಆದ್ಯತೆಯ ಬೆಂಬಲ']},
    ct_title:'ಸಂಪರ್ಕಿಸಿ — ನಿಮ್ಮ ಉಚಿತ ಟ್ರಯಲ್ ನಾವು ಸಿದ್ಧಪಡಿಸುತ್ತೇವೆ',
    ct_sub:'ನಿಮ್ಮ ವಿವರ ಬಿಡಿ, 15-ದಿನದ ಉಚಿತ ಟ್ರಯಲ್ ಆರಂಭಿಸಲು ನಮ್ಮ ತಂಡ ಸಂಪರ್ಕಿಸುತ್ತದೆ. ಕಾರ್ಡ್ ಇಲ್ಲ, ಬದ್ಧತೆ ಇಲ್ಲ — ನಿಮ್ಮ ಬಂಕ್, ನಿಮ್ಮ ಹಿಡಿತದಲ್ಲಿ.',
    ct_bunk:'ಪೆಟ್ರೋಲ್ ಬಂಕ್ ಹೆಸರು', ct_name:'ನಿಮ್ಮ ಹೆಸರು *', ct_phone:'ಮೊಬೈಲ್ ಸಂಖ್ಯೆ *',
    ct_state:'ರಾಜ್ಯ', ct_city:'ನಗರ', ct_cityfirst:'ಮೊದಲು ರಾಜ್ಯ ಆಯ್ಕೆಮಾಡಿ',
    ct_msg:'ನಮಗೆ ಏನಾದರೂ ಹೇಳಲು ಬಯಸುವಿರಾ? (ಐಚ್ಛಿಕ)',
    ct_err:'ಏನೋ ತಪ್ಪಾಗಿದೆ. ಸ್ವಲ್ಪ ಸಮಯದ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
    ct_send:'ಸಂಪರ್ಕಿಸಿ', ct_sending:'ಕಳುಹಿಸಲಾಗುತ್ತಿದೆ…',
    ct_note:'15 ದಿನ ಉಚಿತ ಟ್ರಯಲ್ · ಕ್ರೆಡಿಟ್ ಕಾರ್ಡ್ ಇಲ್ಲ · ಸ್ಪ್ಯಾಮ್ ಇಲ್ಲ.',
    ct_thanks:'ಧನ್ಯವಾದಗಳು!', ct_thanks_sub:'ನಿಮ್ಮ ವಿವರ ಸಿಕ್ಕಿದೆ. ಉಚಿತ ಟ್ರಯಲ್ ಸಿದ್ಧಪಡಿಸಲು ಶೀಘ್ರದಲ್ಲೇ ಸಂಪರ್ಕಿಸುತ್ತೇವೆ.',
  },
  mr: {
    hero:    'प्रत्येक थेंब नियंत्रित करा.',
    hero2:   'प्रत्येक रुपया ट्रॅक करा.',
    sub:     'तुमच्या काउंटरवरून रोज लाखो जातात. Pumpini म्हणजे कधीही न झोपणारी मालकाची वही — प्रत्येक नोझल, प्रत्येक शिफ्ट, प्रत्येक रुपयाचा हिशेब, तुमच्या भाषेत.',
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
    nav_leak:'Pumpini AI', nav_features:'वैशिष्ट्ये', nav_pricing:'किंमत', nav_contact:'संपर्क', login:'लॉगिन', home:'होम',
    hero_badge:'तुमच्या पंपासाठी AI कंट्रोल रूम',
    cta_leak:'तुमच्या AI मॅनेजरला भेटा →',
    cards_t:'तुमच्या मित्रांच्या पंपांवर नसलेल्या तीन गोष्टी.',
    cards_sub:'पुढच्या डीलर्स मीटिंगमध्ये याच गोष्टींनी सुरुवात करा.',
    c1_t:'विचारा. उत्तर तयार.', c1_chip:'AI असिस्टंट',
    c1_d:'“काल किती डिझेल विकलं? सर्वात जास्त उधारी कोणाची?” तुमच्या भाषेत विचारा — Pumpini AI तुमच्या पंपाच्या स्वतःच्या डेटामधून उत्तर देतं.',
    c2_t:'वेट आणि ड्राय. दोन्ही कव्हर.', c2_chip:'संपूर्ण कव्हरेज',
    c2_d:'टँक डिप, डेन्सिटी, डिलिव्हरी, नोझल रीडिंग — शिवाय लूब्स, बारकोड, GST स्टॉकही. बाकीचे सॉफ्टवेअर एकच बाजू निवडतात. Pumpini दोन्ही चालवतं.',
    c3_t:'कॅशची प्रामाणिक मोजणी.', c3_chip:'हिंट नसलेली कॅश तपासणी',
    c3_d:'स्टाफ आधी कॅश मोजून जाहीर करतो — तोपर्यंत अपेक्षित रक्कम लपलेली असते. “मॅच” करायला टार्गेट नाही, खिशात घालायला वाट नाही.',
    ai_badge:'PUMPINI AI', ai_lang:'सहाही भाषांमध्ये',
    ai_old:'“आज काय झालं?”', ai_old_s:'बाकी प्रत्येक सॉफ्टवेअर',
    ai_new:'“उद्या काय होईल?”', ai_new_s:'फक्त Pumpini AI',
    ai_title:'रिपोर्ट्स झालं ते सांगतात. Pumpini होणार ते सांगतो.',
    ai_sub:'पंप चालवण्याची नवी पद्धत: कालचे तुकडे जोडणं थांबवा — उद्याला येण्याआधीच पाहा.',
    ai_q:'वीकेंडआधी टँकर लागेल का?',
    ai_a:'होय — या आठवड्याच्या वेगाने टँक 1 शनिवारी संध्याकाळपर्यंत रिझर्व्हला पोहोचेल. सुट्टीची वाहतूक ~9% वाढवेल. शुक्रवारसाठी टँकर बुक करा.',
    ai_alerts_t:'उद्याचं नुकसान होण्याआधी — आजच पकडलं:',
    ai_al1:'⛽ टँक 2 चा व्हेरियन्स वाढतोय — याच वेगाने या महिन्यात ~700 L नुकसान. मंगळवारची नाईट शिफ्ट आत्ताच तपासा.',
    ai_al2:'💸 एका अटेंडंटच्या शिफ्टमध्ये कॅश पुन्हा पुन्हा कमी — तेच ₹300–500. पुढचं ओळखता येण्यासारखं. आज रात्री लक्ष ठेवा.',
    ai_al3:'🧾 एक क्रेडिट ग्राहक पेमेंट मंदावतोय आणि जास्त भरतोय — पॅटर्न चालू राहिला तर ₹1.9 लाख धोक्यात. पुढच्या फिलिंगआधी फोन करा.',
    ai_note:'बाष्पीभवन, स्टॉक लॉस, कॅश तुटवडा, क्रेडिट रिस्क — Pumpini AI पॅटर्न वाचून वेळेत सावध करतो, पोस्टमॉर्टममध्ये नाही.',
    ez_title:'वापरायला सोपं. आणि सगळं कव्हर.',
    ez_sub:'बाकीचे एकच निवडायला लावतात. Pumpini नाही.',
    ez_x:'सोपं →', ez_y:'↑ जास्त कव्हरेज',
    ez_d1:'जुने डेस्कटॉप सॉफ्टवेअर', ez_d2:'साधी बिलिंग अ‍ॅप्स', ez_d3:'डायरी आणि रजिस्टर',
    ez_we_sub:'AI + व्हॉइस + संपूर्ण कव्हरेज',
    hb1:'6 भाषांमध्ये आवाज', hb2:'आत AI असिस्टंट', hb3:'GPS-लॉक POS',
    ph_title:'आज तुमच्या पंपावर', ph_sub:'फक्त मालक पाहतो ते', ph_live:'लाइव्ह',
    ph_sales:'आतापर्यंतची विक्री', ph_fills:'2,389 लिटर · 318 गाड्या',
    ph_cash:'रोख', ph_credit:'क्रेडिट',
    ph_shift:'शिफ्ट 2 — सुरू', ph_hidden:'कर्मचाऱ्यांना: शिफ्ट बंद होईपर्यंत रक्कम लपलेली',
    ph_tank:'टाकी तफावत:', ph_tankok:'−34 L · मर्यादेत',
    ph_deposit:'₹1,42,000 जमा नाही — 2 दिवस', ph_alert:'अलर्ट',
    ph_note:'वरील प्रत्येक आकडा लाइव्ह अपडेट होतो — तुमच्या भाषेत, तुमच्या फोनवर.',
    permo:'/महिना',
    bd_badge:'फक्त PUMPINI वर — कॅशची प्रामाणिक मोजणी',
    bd_title:'फसवू न शकणारा काउंटर.',
    bd_sub:'बहुतेक पंपांवर ड्रॉवरमध्ये किती रोकड असावी हे कर्मचाऱ्याला नेमके माहीत असते — म्हणून ड्रॉवर नेहमी “जुळतो”. Pumpini खेळच बदलून टाकते.',
    bd_wo:'PUMPINI शिवाय', bd_w:'PUMPINI सह',
    bd_wo1:'मोजण्यापूर्वीच कर्मचारी अपेक्षित रक्कम पाहतो',
    bd_wo2:'राउंड-ऑफ ठेवतो, कमी सुटे देतो, फरक खिशात',
    bd_wo3:'ड्रॉवर दररोज “अचूक जुळतो”',
    bd_wo4:'तुम्हाला जाणवते, पण कधीही सिद्ध करता येत नाही',
    bd_w1:'शिफ्ट सुरू असेपर्यंत विक्रीची रक्कम लपलेली — मॅनेजरपासूनही',
    bd_w2:'कर्मचारी आधी आपली रोकड जाहीर करतो, मग सिस्टम सत्य दाखवते',
    bd_w3:'प्रत्येक तूट नोंदवली — नाव, शिफ्ट, रक्कम, पॅटर्न',
    bd_w4:'प्रामाणिक कर्मचाऱ्यांना संरक्षण वाटते. दुसऱ्या प्रकारचे स्वतःहून सोडून जातात.',
    bd_close:'सुरू शिफ्टची विक्री फक्त मालक पाहतो. मॅनेजर नाही. शिफ्ट प्रमुख नाही.', bd_you:'फक्त तुम्ही.',
    vp_badge:'व्हॉइस POS', vp_pre:'तुमचा कर्मचारी फक्त ', vp_hl:'बोलतो', vp_post:'. Pumpini लिहून घेते.',
    vp_sub:'टायपिंग नाही, प्रशिक्षण नाही, सबबी नाहीत. माइक दाबून मराठी, हिंदी, तेलुगू — कोणत्याही भारतीय भाषेत बोलतो. एंट्री आपोआप भरते आणि एका टॅपवर कन्फर्म.',
    vp_note:'6 भारतीय भाषा समजते — भारत जसा बोलतो त्यासाठी बनलेली व्हॉइस एंट्री.',
    vp_pos:'POS एंट्री', vp_qty:'प्रमाण', vp_pay:'पेमेंट', vp_amt:'रक्कम', vp_50l:'50 लिटर',
    gf_title:'POS फक्त तुमच्या पंपाच्या गेटच्या आत चालते.',
    gf_sub:'100m ते 2km पर्यंत GPS जिओ-फेन्स. हद्दीबाहेर POS स्वतः लॉक होते. कोणाला काढले? एक टॅप आणि त्याचा अॅक्सेस संपला — कुठूनही.',
    gf_inc:'प्रत्येक प्लॅनमध्ये समाविष्ट',
    cmp_sub:'इतर सॉफ्टवेअर पंपांना अर्ध्यावर सोडतात. Pumpini प्रत्येक थेंबाचा — आणि प्रत्येक रुपयाचा — हिशेब ठेवते. बेसिक्समध्ये बरोबरी, मग जुने सॉफ्टवेअर पोहोचू शकत नाही तिथपर्यंत.',
    cmp_feature:'वैशिष्ट्य', cmp_others:'इतर',
    cmp_legend:'✅ समाविष्ट · ⚠️ काही विक्रेत्यांकडेच / बेसिक आवृत्ती · ❌ उपलब्ध नाही',
    cmp_rows:['बिलिंग आणि GST इनव्हॉइस','शिफ्ट आणि कॅश ताळमेळ','टाकी स्टॉक आणि नोझल रीडिंग','क्रेडिट / कॉर्पोरेट ग्राहक','क्लाउड + मोबाइल अॅप','तत्काळ इन-अॅप सूचना','भारतीय भाषांमध्ये व्हॉइस POS','6 भारतीय भाषांमध्ये संपूर्ण अॅप','GPS जिओ-फेन्सिंग सुरक्षा','ब्लाइंड-ड्रॉप कॅश कंट्रोल','AI असिस्टंट — तुमच्या डेटाला विचारा','रिअल-टाइम लाइव्ह डॅशबोर्ड'],
    pr_pop:'सर्वाधिक लोकप्रिय', pr_cta:'मोफत चाचणी सुरू करा',
    pr_foot:'तुमच्या पंपाच्या काउंटरमधून रोज लाखो जातात — दिवसाला एक लिटर पेट्रोलपेक्षा कमी खर्चात त्याचे रक्षण करा.',
    pr_more:'आणखी पंप हवेत? संपर्क करा →',
    plan_starter:{tag:'प्रत्येक थेंब आणि रुपयावर नियंत्रण — एक पंप', perday:'दिवसाला ₹20', note:'दोन कप चहा',
      feats:['1 पेट्रोल पंप','अमर्याद नोझल आणि टाक्या','व्हॉइस POS एंट्री · 6 भारतीय भाषा','ब्लाइंड-ड्रॉप शिफ्ट ताळमेळ','वेट-स्टॉक (टाकी डिप) ताळमेळ','लाइव्ह टाकी तफावत सूचना','पेटी कॅश + बँक ठेव ट्रॅकिंग','डिपस्टिक आणि डिलिव्हरी','रिअल-टाइम डॅशबोर्ड आणि अहवाल','जिओ-फेन्सिंग सुरक्षा']},
    plan_pro:{tag:'संपूर्ण व्यवसाय चालवा — एक पंप', perday:'दिवसाला ₹33', note:'⅓ लिटर पेट्रोल',
      feats:['स्टार्टरमधील सर्व','क्रेडिट ग्राहक आणि GST इनव्हॉइस','क्रेडिट पावत्या आणि नोट्स','लुब्स आणि उत्पादने (बारकोड)','कॅश इंटिग्रिटी मॉनिटरिंग','Tally Prime एक्सपोर्ट','AI असिस्टंट']},
    plan_ent:{tag:'पंपांच्या ग्रुपसाठी', perday:'दिवसाला ₹66', note:'5 पंपांपर्यंत',
      feats:['प्रोमधील सर्व','5 पेट्रोल पंपांपर्यंत','ग्रुप डॅशबोर्ड','मल्टी-स्टेशन अहवाल','कॉर्पोरेट PAN फ्लीट पोर्टल','प्राधान्य सपोर्ट']},
    ct_title:'संपर्क करा — आम्ही तुमची मोफत चाचणी सुरू करून देऊ',
    ct_sub:'तुमचे तपशील द्या, 15-दिवसांची मोफत चाचणी सुरू करण्यासाठी आमची टीम संपर्क करेल. कार्ड नाही, बंधन नाही — फक्त तुमचा पंप, तुमच्या नियंत्रणात.',
    ct_bunk:'पेट्रोल पंपाचे नाव', ct_name:'तुमचे नाव *', ct_phone:'मोबाइल नंबर *',
    ct_state:'राज्य', ct_city:'शहर', ct_cityfirst:'आधी राज्य निवडा',
    ct_msg:'आम्हाला काही सांगायचे आहे? (ऐच्छिक)',
    ct_err:'काहीतरी चूक झाली. कृपया थोड्या वेळाने पुन्हा प्रयत्न करा.',
    ct_send:'संपर्क करा', ct_sending:'पाठवत आहोत…',
    ct_note:'15 दिवस मोफत चाचणी · क्रेडिट कार्ड नाही · स्पॅम नाही.',
    ct_thanks:'धन्यवाद!', ct_thanks_sub:'तुमचे तपशील मिळाले. मोफत चाचणी सुरू करण्यासाठी लवकरच संपर्क करू.',
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
// Row labels live in COPY[lang].cmp_rows (same order); this holds the marks.
const COMPARE = [
  ['yes','yes'],['yes','yes'],['yes','yes'],['yes','yes'],
  ['yes','partial'],['yes','partial'],
  ['yes','no'],['yes','no'],['yes','no'],['yes','no'],['yes','no'],
  ['yes','partial'],
];
const CMP_MARK = { yes:'✅', partial:'⚠️', no:'❌' };

// Structural plan data — all display text comes from COPY[lang].plan_* keys.
const PLANS = [
  { key:'plan_starter', name:'STARTER',    price: 599,  color:'#1FA856', popular:false },
  { key:'plan_pro',     name:'PRO',        price: 999,  color:'#FF6B00', popular:true  },
  { key:'plan_ent',     name:'ENTERPRISE', price: 1999, color:'#0E5A8A', popular:false },
];


const leadInp = {
  width:'100%',padding:'12px 14px',border:'1.5px solid #e5e7eb',borderRadius:10,
  fontSize:14.5,outline:'none',boxSizing:'border-box',fontFamily:'inherit',color:'#1a1a1a',background:'#fff',
};

export default function LandingPage() {
  const [lang,    setLang]     = useState('en');
  const [langOpen,setLangOpen] = useState(false);
  const [scrolled,setScrolled] = useState(false);
  const c = { ...COPY.en, ...(COPY[lang] || {}) }; // English fills any missing key

  // Contact / lead form (wired to /api/leads — do not change)
  const [lead, setLead] = useState({ name:'', phone:'', station_name:'', state:'', city:'', message:'', company:'' });
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
    if (typeof window !== 'undefined') localStorage.setItem('i18nextLng', code);
  };

  return (
    <div style={{fontFamily:'DM Sans,system-ui,sans-serif',color:'#101418',overflowX:'hidden',background:'#fff'}}>

      <style>{`
        :root{ --ink:#07150E; --ink2:#0C2418; --org:#FF6B00; --grn:#1FA856; --grnL:#4ADE80; --cyn:#4DC3E8; --paper:#F7F6F1; }
        @keyframes lpFadeUp { from{opacity:0;transform:translateY(18px)} to{opacity:1;transform:none} }
        @keyframes lpPulse  { 0%,100%{box-shadow:0 0 0 0 rgba(74,222,128,.5)} 50%{box-shadow:0 0 0 7px rgba(74,222,128,0)} }
        @keyframes lpGlow   { 0%,100%{opacity:.5} 50%{opacity:.9} }
        .lp-fade1{animation:lpFadeUp .7s ease both}
        .lp-fade2{animation:lpFadeUp .7s .15s ease both}
        .lp-fade3{animation:lpFadeUp .7s .3s ease both}
        .lp-hero  { grid-template-columns: 1.05fr .95fr; }
        .lp-cards3{ grid-template-columns: repeat(3,1fr); }
        .lp-ai    { grid-template-columns: 1.05fr .95fr; }
        .lp-2col  { grid-template-columns: 1fr 1fr; }
        .lp-cmp   { grid-template-columns: 1fr 90px 90px; }
        .lp-form2 { grid-template-columns: 1fr 1fr; }
        .lp-hero-text { text-align:left }
        .lp-hero-badges { justify-content:flex-start }
        .lp-navlinks { display:flex }
        @media (max-width:880px){
          .lp-hero{grid-template-columns:1fr;gap:2.5rem}
          .lp-hero-text{text-align:center}
          .lp-hero-badges{justify-content:center}
          .lp-2col{grid-template-columns:1fr;gap:2rem !important}
          .lp-cards3{grid-template-columns:1fr}
          .lp-ai{grid-template-columns:1fr}
        }
        @media (max-width:760px){ .lp-navlinks{display:none} }
        @media (max-width:600px){ .lp-cmp{grid-template-columns:1fr 54px 54px} }
        @media (max-width:460px){ .lp-form2{grid-template-columns:1fr} }
        .lp-card:hover{ transform:translateY(-5px); box-shadow:0 16px 44px rgba(7,21,14,.12) !important }
        .lp-card{ transition:transform .25s ease, box-shadow .25s ease }
        html{scroll-behavior:smooth}
      `}</style>

      {/* ── Navbar — white so the logo sits clean, never obscured ── */}
      <nav style={{
        position:'fixed',top:0,left:0,right:0,zIndex:100,background:'#fff',
        borderBottom:'1px solid rgba(0,0,0,.07)',
        boxShadow: scrolled ? '0 2px 14px rgba(0,0,0,.09)' : 'none',
        transition:'box-shadow .3s',padding:'0 5%',
        display:'flex',alignItems:'center',justifyContent:'space-between',height:66,
      }}>
        <Link href="/" style={{display:'flex',alignItems:'center'}} aria-label="Pumpini home">
          <Image src="/pumpini-logo.png" alt="Pumpini — control every drop, track every rupee"
            width={150} height={46} priority style={{objectFit:'contain',display:'block'}}/>
        </Link>

        <div style={{display:'flex',alignItems:'center',gap:'1.4rem'}}>
          <div className="lp-navlinks" style={{alignItems:'center',gap:'1.6rem'}}>
            <a href="#ai"     style={{textDecoration:'none',color:'#3c4752',fontSize:14,fontWeight:600}}>{c.nav_leak}</a>
            <a href="#features" style={{textDecoration:'none',color:'#3c4752',fontSize:14,fontWeight:600}}>{c.nav_features}</a>
            <a href="#pricing"  style={{textDecoration:'none',color:'#3c4752',fontSize:14,fontWeight:600}}>{c.nav_pricing}</a>
            <a href="#contact"  style={{textDecoration:'none',color:'#3c4752',fontSize:14,fontWeight:600}}>{c.nav_contact}</a>
          </div>

          {/* Language switcher */}
          <div style={{position:'relative'}}>
            <button onClick={()=>setLangOpen(p=>!p)}
              style={{display:'flex',alignItems:'center',gap:6,padding:'7px 12px',
                background:'rgba(0,0,0,.05)',border:'none',borderRadius:8,cursor:'pointer',fontSize:13,fontWeight:600}}>
              {LANGS.find(l=>l.code===lang)?.flag} {LANGS.find(l=>l.code===lang)?.label} ▾
            </button>
            {langOpen && (
              <div style={{position:'absolute',right:0,top:'calc(100% + 6px)',background:'#fff',
                borderRadius:10,boxShadow:'0 8px 30px rgba(0,0,0,.15)',padding:'0.5rem',minWidth:160,zIndex:200}}>
                {LANGS.map(l=>(
                  <button key={l.code} onClick={()=>changeLang(l.code)}
                    style={{display:'flex',alignItems:'center',gap:8,width:'100%',padding:'8px 12px',
                      background:lang===l.code?'#fff3e8':'transparent',border:'none',borderRadius:7,
                      cursor:'pointer',fontSize:13,fontWeight:lang===l.code?700:400,
                      color:lang===l.code?'#FF6B00':'#333',textAlign:'left'}}>
                    {l.flag} {l.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Login — wired to the real app */}
          <Link href="/login" style={{padding:'9px 22px',background:'#FF6B00',color:'#fff',
            borderRadius:9,textDecoration:'none',fontWeight:800,fontSize:14,
            boxShadow:'0 3px 14px rgba(255,107,0,.35)'}}>
            {c.login}
          </Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section style={{
        minHeight:'100dvh',
        background:'radial-gradient(1100px 600px at 85% -10%, rgba(31,168,86,.22), transparent 60%),'+
                   'radial-gradient(900px 500px at -10% 110%, rgba(255,107,0,.16), transparent 55%),'+
                   'linear-gradient(160deg, #07150E 0%, #0C2418 55%, #07150E 100%)',
        display:'flex',alignItems:'center',justifyContent:'center',
        padding:'100px 5% 70px',position:'relative',overflow:'hidden',
      }}>
        {/* faint rupee grid */}
        <div aria-hidden style={{position:'absolute',inset:0,opacity:.05,fontSize:120,fontWeight:900,
          color:'#fff',display:'flex',flexWrap:'wrap',gap:60,alignContent:'space-between',
          justifyContent:'space-between',padding:'4%',pointerEvents:'none',userSelect:'none'}}>
          <span>₹</span><span>⛽</span><span>₹</span><span>⛽</span><span>₹</span>
        </div>

        <div className="lp-hero" style={{maxWidth:1160,width:'100%',display:'grid',gap:'3.5rem',
          alignItems:'center',position:'relative',zIndex:1}}>

          {/* LEFT — the promise */}
          <div className="lp-hero-text">
            <div className="lp-fade1" style={{display:'inline-flex',alignItems:'center',gap:8,
              background:'rgba(255,107,0,.14)',border:'1px solid rgba(255,107,0,.35)',borderRadius:99,
              padding:'7px 16px',marginBottom:'1.4rem',fontSize:13,fontWeight:700,color:'#FFA45C'}}>
              ⛽ {c.hero_badge}
            </div>

            <h1 className="lp-fade1" style={{fontSize:'clamp(2.5rem,5.2vw,4.2rem)',fontWeight:900,lineHeight:1.07,
              color:'#fff',marginBottom:'0.4rem',letterSpacing:'-.03em'}}>
              {c.hero}
            </h1>
            <h1 className="lp-fade2" style={{fontSize:'clamp(2.5rem,5.2vw,4.2rem)',fontWeight:900,lineHeight:1.07,
              background:'linear-gradient(90deg,#FFB347,#FF6B00)',
              WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',
              marginBottom:'1.4rem',letterSpacing:'-.03em'}}>
              {c.hero2}
            </h1>

            <p className="lp-fade2" style={{fontSize:'clamp(1.02rem,1.6vw,1.18rem)',color:'rgba(255,255,255,.75)',
              maxWidth:540,lineHeight:1.65,marginBottom:'2.1rem'}}>
              {c.sub}
            </p>

            <div className="lp-fade3" style={{display:'flex',gap:14,flexWrap:'wrap',marginBottom:'2.2rem'}}>
              <a href="#ai" style={{padding:'15px 28px',background:'#FF6B00',color:'#fff',borderRadius:12,
                textDecoration:'none',fontWeight:800,fontSize:16,boxShadow:'0 6px 26px rgba(255,107,0,.45)'}}>
                {c.cta_leak}
              </a>
              <a href="#pricing" style={{padding:'15px 28px',background:'rgba(255,255,255,.08)',color:'#fff',
                borderRadius:12,textDecoration:'none',fontWeight:700,fontSize:16,
                border:'1px solid rgba(255,255,255,.25)'}}>
                {c.nav_pricing}
              </a>
            </div>

            <div className="lp-hero-badges lp-fade3" style={{display:'flex',gap:'1.4rem',flexWrap:'wrap',
              fontSize:13.5,color:'rgba(255,255,255,.55)',fontWeight:600}}>
              <span>🎙 {c.hb1}</span>
              <span>🔒 {c.hb2}</span>
              <span>📍 {c.hb3}</span>
              <span>🧾 GST + Tally</span>
            </div>
          </div>

          {/* RIGHT — "today at your bunk" owner phone view */}
          <div className="lp-fade3" style={{position:'relative',display:'flex',justifyContent:'center'}}>
            <div aria-hidden style={{position:'absolute',inset:'-8% 6%',background:
              'radial-gradient(circle, rgba(31,168,86,.4) 0%, transparent 70%)',
              filter:'blur(46px)',zIndex:0,animation:'lpGlow 5s ease infinite'}}/>
            <div style={{position:'relative',zIndex:1,width:'100%',maxWidth:392,background:'#fff',
              borderRadius:22,overflow:'hidden',boxShadow:'0 28px 80px rgba(0,0,0,.5)',
              border:'1px solid rgba(255,255,255,.14)'}}>

              {/* header */}
              <div style={{display:'flex',alignItems:'center',gap:10,padding:'14px 18px',
                background:'linear-gradient(120deg,#0C2418,#16402B)'}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:14.5,fontWeight:800,color:'#fff'}}>{c.ph_title}</div>
                  <div style={{fontSize:11.5,color:'rgba(255,255,255,.65)'}}>{c.ph_sub}</div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:6,fontSize:11.5,color:'#4ADE80',fontWeight:700}}>
                  <span style={{width:8,height:8,borderRadius:'50%',background:'#4ADE80',
                    animation:'lpPulse 2s infinite'}}/>
                  {c.ph_live}
                </div>
              </div>

              {/* the money */}
              <div style={{padding:'18px 18px 6px',background:'#fff'}}>
                <div style={{fontSize:12,fontWeight:700,color:'#8a93a0',textTransform:'uppercase',letterSpacing:.5}}>{c.ph_sales}</div>
                <div style={{fontSize:38,fontWeight:900,color:'#0C2418',letterSpacing:'-.02em',lineHeight:1.15}}>₹2,41,350</div>
                <div style={{fontSize:13,color:'#1FA856',fontWeight:700,marginBottom:14}}>▲ {c.ph_fills}</div>

                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:14}}>
                  {[[c.ph_cash,'₹98,400'],['UPI','₹1,04,800'],[c.ph_credit,'₹38,150']].map(([k,v])=>(
                    <div key={k} style={{background:'#F4F7F4',borderRadius:10,padding:'9px 10px'}}>
                      <div style={{fontSize:11,color:'#8a93a0',fontWeight:700}}>{k}</div>
                      <div style={{fontSize:14.5,fontWeight:800,color:'#0C2418'}}>{v}</div>
                    </div>
                  ))}
                </div>

                {/* blind drop row — the USP, shown as the staff sees it */}
                <div style={{display:'flex',alignItems:'center',gap:10,background:'#FFF6EC',
                  border:'1px dashed #FFB066',borderRadius:12,padding:'11px 13px',marginBottom:10}}>
                  <span style={{fontSize:20}}>🔒</span>
                  <div style={{flex:1}}>
                    <div style={{fontSize:12.5,fontWeight:800,color:'#9a3412'}}>{c.ph_shift}</div>
                    <div style={{fontSize:11.5,color:'#b45309'}}>{c.ph_hidden}</div>
                  </div>
                  <div style={{fontSize:13,fontWeight:900,color:'#9a3412',letterSpacing:2}}>₹ ●●●●●</div>
                </div>

                <div style={{display:'flex',alignItems:'center',gap:10,background:'#F0FAF3',
                  border:'1px solid #BBE7C9',borderRadius:12,padding:'11px 13px',marginBottom:10}}>
                  <span style={{fontSize:18}}>🛢️</span>
                  <div style={{flex:1,fontSize:12.5,fontWeight:700,color:'#14532d'}}>
                    {c.ph_tank} <span style={{color:'#1FA856'}}>{c.ph_tankok}</span>
                  </div>
                  <span style={{width:9,height:9,borderRadius:'50%',background:'#1FA856'}}/>
                </div>

                <div style={{display:'flex',alignItems:'center',gap:10,background:'#FEF2F2',
                  border:'1px solid #FECACA',borderRadius:12,padding:'11px 13px'}}>
                  <span style={{fontSize:18}}>🏦</span>
                  <div style={{flex:1,fontSize:12.5,fontWeight:700,color:'#7f1d1d'}}>
                    {c.ph_deposit}
                  </div>
                  <span style={{fontSize:12,fontWeight:900,color:'#dc2626'}}>{c.ph_alert}</span>
                </div>
              </div>

              <div style={{padding:'12px 18px 16px',fontSize:11.5,color:'#9aa3ad',background:'#fff'}}>
                {c.ph_note}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Three brag cards — AI · wet+dry · honest cash ── */}
      <section style={{background:'#fff',padding:'4.5rem 1.5rem 4rem'}}>
        <div style={{maxWidth:1100,margin:'0 auto',textAlign:'center'}}>
          <h2 style={{fontSize:'clamp(1.8rem,3.2vw,2.5rem)',fontWeight:900,color:'var(--ink2)',marginBottom:8,letterSpacing:'-.02em'}}>{c.cards_t}</h2>
          <p style={{color:'#5b6570',fontSize:16,marginBottom:'2.4rem'}}>{c.cards_sub}</p>
          <div className="lp-cards3" style={{display:'grid',gap:'1.2rem',textAlign:'left'}}>
            {[
              {e:'🤖', t:c.c1_t, d:c.c1_d, chip:c.c1_chip, col:'#0E7490', bg:'rgba(77,195,232,.10)'},
              {e:'🛢️', t:c.c2_t, d:c.c2_d, chip:c.c2_chip, col:'#1FA856', bg:'rgba(31,168,86,.09)'},
              {e:'🔐', t:c.c3_t, d:c.c3_d, chip:c.c3_chip, col:'#FF6B00', bg:'rgba(255,107,0,.08)'},
            ].map((k,i)=>(
              <div key={i} className="lp-card" style={{background:k.bg,borderTop:`4px solid ${k.col}`,
                border:`1px solid ${k.col}26`,borderTopWidth:4,borderTopColor:k.col,borderRadius:18,padding:'1.7rem 1.5rem'}}>
                <div style={{fontSize:46,lineHeight:1,marginBottom:14}}>{k.e}</div>
                <h3 style={{fontSize:'1.28rem',fontWeight:900,color:'var(--ink2)',marginBottom:8}}>{k.t}</h3>
                <p style={{fontSize:14.5,color:'#475259',lineHeight:1.62,marginBottom:16}}>{k.d}</p>
                <span style={{display:'inline-block',fontSize:11.5,fontWeight:800,letterSpacing:'.06em',
                  textTransform:'uppercase',color:k.col,background:'#fff',border:`1px solid ${k.col}55`,
                  borderRadius:99,padding:'4px 11px'}}>{k.chip}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PUMPINI AI — ask anything + pattern alerts ── */}
      <section id="ai" style={{position:'relative',overflow:'hidden',padding:'5rem 1.5rem',
        background:'radial-gradient(900px 500px at 12% -5%, rgba(77,195,232,.20), transparent 55%),'+
                   'radial-gradient(800px 500px at 95% 105%, rgba(255,107,0,.16), transparent 55%),'+
                   'linear-gradient(160deg, #07150E 0%, #0C2418 60%, #07150E 100%)'}}>
        <div style={{maxWidth:1100,margin:'0 auto',position:'relative'}}>
          <div style={{textAlign:'center',marginBottom:'2.6rem'}}>
            <div style={{display:'inline-block',background:'rgba(77,195,232,.15)',border:'1px solid rgba(77,195,232,.45)',
              borderRadius:99,padding:'7px 16px',fontSize:12.5,fontWeight:800,letterSpacing:'.08em',color:'#7DD7F0',marginBottom:'1.1rem'}}>
              ✨ {c.ai_badge}
            </div>
            <h2 style={{fontSize:'clamp(1.8rem,3.4vw,2.6rem)',fontWeight:900,color:'#fff',letterSpacing:'-.02em',marginBottom:10}}>{c.ai_title}</h2>
            <p style={{color:'rgba(255,255,255,.7)',fontSize:16.5,maxWidth:640,margin:'0 auto'}}>{c.ai_sub}</p>
          </div>
          {/* yesterday → tomorrow: the shift Pumpini brings */}
          <div style={{display:'flex',gap:16,justifyContent:'center',alignItems:'center',flexWrap:'wrap',marginBottom:'2.6rem'}}>
            <div style={{textAlign:'center',background:'rgba(255,255,255,.05)',border:'1px solid rgba(255,255,255,.16)',
              borderRadius:14,padding:'12px 22px',opacity:.7}}>
              <div style={{fontSize:15.5,fontWeight:800,color:'rgba(255,255,255,.75)'}}>{c.ai_old}</div>
              <div style={{fontSize:11.5,color:'rgba(255,255,255,.45)',marginTop:3}}>{c.ai_old_s}</div>
            </div>
            <div style={{fontSize:24,color:'#7DD7F0',fontWeight:900}}>→</div>
            <div style={{textAlign:'center',background:'linear-gradient(135deg, rgba(77,195,232,.20), rgba(255,107,0,.16))',
              border:'1px solid rgba(77,195,232,.55)',borderRadius:14,padding:'12px 22px',
              boxShadow:'0 10px 34px rgba(77,195,232,.22)'}}>
              <div style={{fontSize:15.5,fontWeight:900,color:'#fff'}}>{c.ai_new}</div>
              <div style={{fontSize:11.5,fontWeight:800,color:'#7DD7F0',marginTop:3}}>{c.ai_new_s}</div>
            </div>
          </div>
          <div className="lp-ai" style={{display:'grid',gap:'1.5rem',alignItems:'stretch'}}>
            {/* chat demo */}
            <div style={{background:'#fff',borderRadius:20,padding:'1.4rem 1.4rem 1.2rem',boxShadow:'0 24px 70px rgba(0,0,0,.45)'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,
                paddingBottom:12,borderBottom:'1px solid #eef0ee'}}>
                <span style={{fontWeight:900,color:'var(--ink2)',fontSize:15}}>✨ Pumpini AI</span>
                <span style={{fontSize:11.5,fontWeight:700,color:'#0E7490',background:'rgba(77,195,232,.12)',
                  border:'1px solid rgba(14,116,144,.3)',borderRadius:99,padding:'3px 10px'}}>{c.ai_lang}</span>
              </div>
              <div style={{display:'flex',justifyContent:'flex-end',marginBottom:12}}>
                <div style={{maxWidth:'82%',background:'#FFF1E6',border:'1px solid rgba(255,107,0,.25)',
                  borderRadius:'16px 16px 4px 16px',padding:'10px 14px',fontSize:14.5,fontWeight:600,color:'#7a3c10'}}>
                  🎙 {c.ai_q}
                </div>
              </div>
              <div style={{display:'flex',marginBottom:6}}>
                <div style={{maxWidth:'88%',background:'#F2F7F4',border:'1px solid #dfe9e2',
                  borderRadius:'16px 16px 16px 4px',padding:'11px 14px',fontSize:14.5,lineHeight:1.6,color:'#1d2a22'}}>
                  {c.ai_a}
                </div>
              </div>
            </div>
            {/* pattern alerts */}
            <div style={{display:'flex',flexDirection:'column',gap:12,justifyContent:'center'}}>
              <div style={{fontWeight:800,color:'#4ADE80',fontSize:14,letterSpacing:'.04em',marginBottom:2}}>{c.ai_alerts_t}</div>
              {[c.ai_al1,c.ai_al2,c.ai_al3].map((t,i)=>(
                <div key={i} style={{background:'rgba(255,255,255,.06)',border:'1px solid rgba(255,255,255,.14)',
                  borderLeft:'3px solid #FF6B00',borderRadius:12,padding:'13px 15px',fontSize:14,
                  lineHeight:1.55,color:'rgba(255,255,255,.88)'}}>{t}</div>
              ))}
            </div>
          </div>
          <p style={{textAlign:'center',color:'rgba(255,255,255,.55)',fontSize:14,marginTop:'2.2rem',maxWidth:720,marginLeft:'auto',marginRight:'auto'}}>
            {c.ai_note}
          </p>
        </div>
      </section>

      {/* ── Easy to use × covers everything — quadrant illustration ── */}
      <section style={{background:'var(--paper)',padding:'4.5rem 1.5rem 5rem'}}>
        <div style={{maxWidth:900,margin:'0 auto',textAlign:'center'}}>
          <h2 style={{fontSize:'clamp(1.8rem,3.2vw,2.5rem)',fontWeight:900,color:'var(--ink2)',marginBottom:8,letterSpacing:'-.02em'}}>{c.ez_title}</h2>
          <p style={{color:'#5b6570',fontSize:16,marginBottom:'3rem'}}>{c.ez_sub}</p>
          <div style={{position:'relative',margin:'0 auto',maxWidth:620,height:360,
            borderLeft:'3px solid var(--ink2)',borderBottom:'3px solid var(--ink2)',
            background:'linear-gradient(135deg, rgba(255,107,0,.04), rgba(77,195,232,.08))',borderRadius:'0 0 0 4px'}}>
            <div style={{position:'absolute',bottom:-32,right:0,fontWeight:800,fontSize:13.5,color:'var(--ink2)'}}>{c.ez_x}</div>
            <div style={{position:'absolute',top:-30,left:-2,fontWeight:800,fontSize:13.5,color:'var(--ink2)'}}>{c.ez_y}</div>
            {[
              {t:c.ez_d1, top:'16%', left:'10%'},
              {t:c.ez_d3, top:'76%', left:'30%'},
              {t:c.ez_d2, top:'62%', left:'66%'},
            ].map((d,i)=>(
              <div key={i} style={{position:'absolute',top:d.top,left:d.left,textAlign:'center',transform:'translate(-50%,-50%)'}}>
                <div style={{width:14,height:14,borderRadius:'50%',background:'#9aa3ab',margin:'0 auto 6px',
                  border:'3px solid #fff',boxShadow:'0 2px 6px rgba(0,0,0,.2)'}}/>
                <div style={{fontSize:12.5,fontWeight:700,color:'#5b6570',maxWidth:130,lineHeight:1.3}}>{d.t}</div>
              </div>
            ))}
            <div style={{position:'absolute',top:'13%',right:'5%',textAlign:'center'}}>
              <div style={{display:'inline-block',background:'linear-gradient(135deg,#FF8C3B,#FF6B00)',color:'#fff',
                fontWeight:900,fontSize:16,borderRadius:99,padding:'9px 20px',
                boxShadow:'0 10px 30px rgba(255,107,0,.45)',animation:'lpGlow 4s ease infinite'}}>✦ Pumpini</div>
              <div style={{fontSize:12,fontWeight:800,color:'#FF6B00',marginTop:7}}>{c.ez_we_sub}</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Blind-drop story — THE USP ── */}
      <section style={{padding:'5.5rem 5%',background:'var(--ink)',color:'#fff',position:'relative',overflow:'hidden'}}>
        <div aria-hidden style={{position:'absolute',inset:0,opacity:.05,backgroundImage:
          'radial-gradient(circle at 15% 20%, #FF6B00 0%, transparent 45%), radial-gradient(circle at 85% 85%, #1FA856 0%, transparent 45%)'}}/>
        <div style={{maxWidth:1080,margin:'0 auto',position:'relative'}}>
          <div style={{textAlign:'center',marginBottom:'3rem'}}>
            <div style={{display:'inline-block',background:'rgba(255,107,0,.16)',color:'#FFA45C',
              border:'1px solid rgba(255,107,0,.35)',padding:'5px 14px',borderRadius:99,fontSize:12.5,fontWeight:800,marginBottom:'0.9rem'}}>
              🔒 {c.bd_badge}
            </div>
            <h2 style={{fontSize:'clamp(1.8rem,3vw,2.6rem)',fontWeight:900,marginBottom:'0.6rem'}}>
              {c.bd_title}
            </h2>
            <p style={{fontSize:16,color:'rgba(255,255,255,.65)',maxWidth:640,margin:'0 auto',lineHeight:1.7}}>
              {c.bd_sub}
            </p>
          </div>

          <div className="lp-2col" style={{display:'grid',gap:'1.6rem'}}>
            <div style={{background:'rgba(220,38,38,.08)',border:'1px solid rgba(220,38,38,.3)',
              borderRadius:18,padding:'1.9rem'}}>
              <div style={{fontSize:13,fontWeight:900,color:'#FCA5A5',letterSpacing:1,marginBottom:14}}>{c.bd_wo}</div>
              {[
                ['👀', c.bd_wo1],
                ['✂️', c.bd_wo2],
                ['🤷', c.bd_wo3],
                ['😶', c.bd_wo4],
              ].map(([i,t])=>(
                <div key={t} style={{display:'flex',gap:12,alignItems:'flex-start',marginBottom:12,fontSize:14.5,
                  color:'rgba(255,255,255,.8)',lineHeight:1.55}}>
                  <span style={{fontSize:18,flexShrink:0}}>{i}</span><span>{t}</span>
                </div>
              ))}
            </div>
            <div style={{background:'rgba(31,168,86,.1)',border:'1px solid rgba(74,222,128,.35)',
              borderRadius:18,padding:'1.9rem'}}>
              <div style={{fontSize:13,fontWeight:900,color:'#4ADE80',letterSpacing:1,marginBottom:14}}>{c.bd_w}</div>
              {[
                ['🙈', c.bd_w1],
                ['✍️', c.bd_w2],
                ['📋', c.bd_w3],
                ['😌', c.bd_w4],
              ].map(([i,t])=>(
                <div key={t} style={{display:'flex',gap:12,alignItems:'flex-start',marginBottom:12,fontSize:14.5,
                  color:'rgba(255,255,255,.85)',lineHeight:1.55}}>
                  <span style={{fontSize:18,flexShrink:0}}>{i}</span><span>{t}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{textAlign:'center',marginTop:'2.2rem',fontSize:15.5,fontWeight:700,color:'rgba(255,255,255,.7)'}}>
            {c.bd_close} <span style={{color:'#4ADE80'}}>{c.bd_you}</span>
          </div>
        </div>
      </section>

      {/* ── Voice POS Highlight ── */}
      <section style={{background:'#FFF7ED',padding:'5.5rem 5%',borderTop:'3px solid #FF6B00'}}>
        <div className="lp-2col" style={{maxWidth:1100,margin:'0 auto',display:'grid',gap:'4rem',alignItems:'center'}}>
          <div>
            <div style={{display:'inline-block',background:'#FF6B00',color:'#fff',
              padding:'4px 12px',borderRadius:99,fontSize:12,fontWeight:700,marginBottom:'1rem'}}>
              🎙 {c.vp_badge}
            </div>
            <h2 style={{fontSize:'clamp(1.8rem,3vw,2.5rem)',fontWeight:900,lineHeight:1.2,marginBottom:'1rem',color:'#0C2418'}}>
              {c.vp_pre}<span style={{color:'#FF6B00'}}>{c.vp_hl}</span>{c.vp_post}
            </h2>
            <p style={{fontSize:16,color:'#555',lineHeight:1.7,marginBottom:'1.5rem'}}>
              {c.vp_sub}
            </p>
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              {[
                ['తెలుగు', '"యాభై లీటర్లు పెట్రోల్ నగదు"', '50L Petrol · Cash'],
                ['தமிழ்',  '"ஐம்பது லிட்டர் டீசல் UPI"',    '50L Diesel · UPI'],
                ['हिन्दी', '"पचास लीटर पेट्रोल कैश"',       '50L Petrol · Cash'],
              ].map(([lg, spoken, parsed]) => (
                <div key={lg} style={{background:'#fff',borderRadius:12,padding:'0.75rem 1rem',
                  border:'1px solid #fed7aa',display:'flex',alignItems:'center',gap:12}}>
                  <span style={{fontSize:11,fontWeight:700,color:'#9a3412',background:'#ffe9d6',
                    padding:'2px 8px',borderRadius:99,flexShrink:0}}>{lg}</span>
                  <span style={{fontSize:14,color:'#555',flex:1}}>{spoken}</span>
                  <span style={{fontSize:12,fontWeight:700,color:'#16a34a',
                    background:'#dcfce7',padding:'2px 8px',borderRadius:99,flexShrink:0}}>→ {parsed}</span>
                </div>
              ))}
            </div>
            <div style={{marginTop:'1rem',fontSize:12.5,color:'#888'}}>
              {c.vp_note}
            </div>
          </div>
          <div style={{background:'#0C2418',borderRadius:20,padding:'2rem',position:'relative'}}>
            <div style={{textAlign:'center',marginBottom:'1.5rem'}}>
              <div style={{fontSize:13,color:'rgba(255,255,255,.5)',marginBottom:'0.5rem'}}>{c.vp_pos}</div>
              <div style={{fontSize:11,color:'rgba(255,255,255,.3)'}}>Dilsukhnagar Bunk · Shift 1</div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:'1rem'}}>
              {[['N1','Petrol','₹102/L'],['N2','Diesel','₹90/L']].map(([n,f,p])=>(
                <div key={n} style={{background:'rgba(255,107,0,.18)',border:'2px solid #FF6B00',
                  borderRadius:10,padding:'0.75rem',textAlign:'center'}}>
                  <div style={{fontWeight:800,color:'#FFA45C',fontSize:16}}>{n}</div>
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
                &ldquo;50 లీటర్లు పెట్రోల్ నగదు&rdquo;
              </div>
            </div>
            <div style={{background:'rgba(74,222,128,.12)',border:'1px solid rgba(74,222,128,.3)',
              borderRadius:10,padding:'0.75rem',fontSize:12}}>
              <div style={{display:'flex',justifyContent:'space-between',color:'rgba(255,255,255,.6)',marginBottom:4}}>
                <span>{c.vp_qty}</span><span style={{fontWeight:700,color:'#fff'}}>{c.vp_50l}</span>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',color:'rgba(255,255,255,.6)',marginBottom:4}}>
                <span>{c.vp_pay}</span><span style={{fontWeight:700,color:'#fff'}}>{c.ph_cash}</span>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',color:'rgba(255,255,255,.6)'}}>
                <span>{c.vp_amt}</span><span style={{fontWeight:700,color:'#4ADE80'}}>₹5,100</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features Grid + geo-fence strip ── */}
      <section id="features" style={{padding:'5.5rem 5%',background:'var(--paper)'}}>
        <div style={{maxWidth:1100,margin:'0 auto'}}>
          <div style={{textAlign:'center',marginBottom:'3rem'}}>
            <h2 style={{fontSize:'clamp(1.8rem,3vw,2.5rem)',fontWeight:900,marginBottom:'0.5rem',color:'#0C2418'}}>
              {c.feat_title}
            </h2>
            <p style={{fontSize:16,color:'#5b6570'}}>{c.feat_sub}</p>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:'1.5rem'}}>
            {FEATURES.map(feat => (
              <div key={feat.key} className="lp-card" style={{background:'#fff',borderRadius:16,padding:'1.75rem',
                border:'1px solid #e8e6df',cursor:'default',boxShadow:'0 2px 10px rgba(7,21,14,.04)'}}>
                <div style={{fontSize:36,marginBottom:'1rem'}}>{feat.icon}</div>
                <h3 style={{fontWeight:800,fontSize:17,marginBottom:'0.5rem',color:'#0C2418'}}>{c[`${feat.key}_t`]}</h3>
                <p style={{fontSize:14,color:'#5b6570',lineHeight:1.6,margin:0}}>{c[`${feat.key}_d`]}</p>
              </div>
            ))}
          </div>

          {/* geo-fence strip */}
          <div className="lp-card" style={{marginTop:'1.5rem',background:'linear-gradient(120deg,#0C2418,#123524)',
            borderRadius:16,padding:'1.6rem 1.9rem',display:'flex',alignItems:'center',gap:18,flexWrap:'wrap',
            color:'#fff',border:'1px solid rgba(74,222,128,.2)'}}>
            <span style={{fontSize:36}}>📍</span>
            <div style={{flex:1,minWidth:240}}>
              <div style={{fontWeight:850,fontSize:17,marginBottom:4}}>{c.gf_title}</div>
              <div style={{fontSize:14,color:'rgba(255,255,255,.65)',lineHeight:1.6}}>
                {c.gf_sub}
              </div>
            </div>
            <span style={{fontSize:13,fontWeight:800,color:'#4ADE80',background:'rgba(74,222,128,.12)',
              border:'1px solid rgba(74,222,128,.3)',padding:'8px 14px',borderRadius:99,whiteSpace:'nowrap'}}>
              {c.gf_inc}
            </span>
          </div>
        </div>
      </section>

      {/* ── Comparison table ── */}
      <section style={{padding:'5.5rem 5%',background:'#fff'}}>
        <div style={{maxWidth:820,margin:'0 auto'}}>
          <h2 style={{textAlign:'center',fontSize:'clamp(1.8rem,3vw,2.5rem)',fontWeight:900,marginBottom:'0.75rem',color:'#0C2418'}}>
            {c.compare_title}
          </h2>
          <p style={{textAlign:'center',fontSize:16,color:'#5b6570',fontStyle:'italic',
            maxWidth:620,margin:'0 auto 2.5rem',lineHeight:1.6}}>
            {c.cmp_sub}
          </p>
          <div style={{borderRadius:16,overflow:'hidden',border:'1px solid #e8e6df',boxShadow:'0 4px 24px rgba(7,21,14,.06)'}}>
            <div className="lp-cmp" style={{display:'grid',
              background:'var(--ink2)',color:'#fff',padding:'1rem 1.5rem',fontWeight:700,fontSize:14}}>
              <div>{c.cmp_feature}</div>
              <div style={{textAlign:'center',color:'#FFA45C'}}>Pumpini</div>
              <div style={{textAlign:'center',color:'rgba(255,255,255,.45)'}}>{c.cmp_others}</div>
            </div>
            {COMPARE.map(([us, them], i) => (
              <div key={i} className="lp-cmp" style={{display:'grid',
                padding:'0.875rem 1.5rem',background: i%2===0?'#fff':'#f7f6f1',
                borderBottom:'1px solid #f0efe9',fontSize:14,alignItems:'center'}}>
                <div style={{fontWeight:500}}>{c.cmp_rows[i]}</div>
                <div style={{textAlign:'center',fontSize:18}}>{CMP_MARK[us]}</div>
                <div style={{textAlign:'center',fontSize:18}}>{CMP_MARK[them]}</div>
              </div>
            ))}
          </div>
          <div style={{textAlign:'center',marginTop:'1rem',fontSize:12.5,color:'#888'}}>
            {c.cmp_legend}
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" style={{padding:'5.5rem 5%',background:'var(--paper)'}}>
        <div style={{maxWidth:1000,margin:'0 auto'}}>
          <div style={{textAlign:'center',marginBottom:'3rem'}}>
            <h2 style={{fontSize:'clamp(1.8rem,3vw,2.5rem)',fontWeight:900,marginBottom:'0.5rem',color:'#0C2418'}}>
              {c.pricing_title}
            </h2>
            <p style={{fontSize:15,color:'#5b6570'}}>{c.pricing_sub}</p>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))',gap:'1.5rem'}}>
            {PLANS.map(plan => { const pc = c[plan.key]; return (
              <div key={plan.name} className="lp-card" style={{background:'#fff',borderRadius:20,padding:'2rem',
                border: plan.popular ? `2.5px solid #FF6B00` : '1px solid #e8e6df',
                position:'relative',boxShadow: plan.popular ? '0 10px 44px rgba(255,107,0,.18)' : '0 2px 10px rgba(7,21,14,.04)'}}>
                {plan.popular && (
                  <div style={{position:'absolute',top:-13,left:'50%',transform:'translateX(-50%)',
                    background:'#FF6B00',color:'#fff',padding:'4px 16px',borderRadius:99,
                    fontSize:12,fontWeight:700,whiteSpace:'nowrap'}}>
                    {c.pr_pop}
                  </div>
                )}
                <div style={{fontWeight:900,fontSize:18,color:plan.color,marginBottom:'0.25rem'}}>
                  {plan.name}
                </div>
                <div style={{fontSize:12.5,color:'#8a93a0',marginBottom:'0.6rem'}}>{pc.tag}</div>
                <div style={{display:'flex',alignItems:'baseline',gap:4}}>
                  <span style={{fontSize:34,fontWeight:900,color:'#0C2418'}}>₹{plan.price.toLocaleString('en-IN')}</span>
                  <span style={{fontSize:14,color:'#888'}}>{c.permo}</span>
                </div>
                {/* per-day framing — speaks the owner's arithmetic */}
                <div style={{display:'inline-block',margin:'8px 0 1.2rem',background:'#F0FAF3',color:'#14532d',
                  border:'1px solid #BBE7C9',padding:'4px 12px',borderRadius:99,fontSize:12.5,fontWeight:800}}>
                  {pc.perday} · {pc.note}
                </div>
                <ul style={{listStyle:'none',padding:0,margin:'0 0 1.5rem',
                  display:'flex',flexDirection:'column',gap:8}}>
                  {pc.feats.map(f => (
                    <li key={f} style={{display:'flex',alignItems:'flex-start',gap:8,fontSize:13.5}}>
                      <span style={{color:'#1FA856',flexShrink:0,marginTop:1,fontWeight:900}}>✓</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/login" style={{display:'block',textAlign:'center',padding:'13px',
                  background: plan.popular ? '#FF6B00' : '#0C2418',color:'#fff',borderRadius:10,
                  textDecoration:'none',fontWeight:800,fontSize:14.5}}>
                  {c.pr_cta}
                </Link>
              </div>
            );})}
          </div>
          <div style={{textAlign:'center',marginTop:'2rem',fontSize:13.5,color:'#5b6570'}}>
            {c.pr_foot}{' '}
            <a href="#contact" style={{color:'#FF6B00',fontWeight:700}}>{c.pr_more}</a>
          </div>
        </div>
      </section>

      {/* ── Contact form (wired to /api/leads — fields unchanged) ── */}
      <section id="contact" style={{padding:'5.5rem 5%',
        background:'radial-gradient(900px 500px at 80% 0%, rgba(31,168,86,.18), transparent 55%),'+
                   'linear-gradient(160deg, #07150E 0%, #0C2418 100%)',
        color:'#fff',textAlign:'center'}}>
        <div style={{maxWidth:560,margin:'0 auto'}}>
          <div style={{fontSize:46,marginBottom:'1rem'}}>🤝</div>
          <h2 style={{fontSize:'clamp(1.8rem,3vw,2.5rem)',fontWeight:900,marginBottom:'0.75rem'}}>
            {c.ct_title}
          </h2>
          <p style={{fontSize:16,color:'rgba(255,255,255,.65)',marginBottom:'2rem'}}>
            {c.ct_sub}
          </p>

          <form onSubmit={submitLead} style={{background:'#fff',borderRadius:18,padding:'1.9rem',
            textAlign:'left',boxShadow:'0 24px 70px rgba(0,0,0,.4)',position:'relative'}}>
            {leadState === 'done' ? (
              <div style={{textAlign:'center',padding:'1.5rem 0'}}>
                <div style={{fontSize:44,marginBottom:'0.75rem'}}>✅</div>
                <div style={{fontSize:18,fontWeight:800,color:'#0C2418',marginBottom:6}}>{c.ct_thanks}</div>
                <div style={{fontSize:14,color:'#555',lineHeight:1.6}}>
                  {c.ct_thanks_sub}
                </div>
              </div>
            ) : (
              <>
                {/* Honeypot — hidden from humans, traps bots */}
                <input type="text" name="company" value={lead.company} tabIndex={-1} autoComplete="off"
                  aria-hidden="true" onChange={e=>setL('company', e.target.value)}
                  style={{position:'absolute',left:'-9999px',width:1,height:1,opacity:0}}/>

                <input style={{...leadInp, marginBottom:12}} placeholder={c.ct_bunk} value={lead.station_name}
                  onChange={e=>setL('station_name', e.target.value)}/>
                <div className="lp-form2" style={{display:'grid',gap:12,marginBottom:12}}>
                  <input style={leadInp} placeholder={c.ct_name} value={lead.name}
                    onChange={e=>setL('name', e.target.value)} required/>
                  <input style={leadInp} type="tel" placeholder={c.ct_phone} value={lead.phone}
                    onChange={e=>setL('phone', e.target.value)} required/>
                </div>
                <div className="lp-form2" style={{display:'grid',gap:12,marginBottom:12}}>
                  <select style={{...leadInp, color: lead.state?'#111':'#9ca3af'}} value={lead.state}
                    onChange={e=>{ setL('state', e.target.value); setL('city',''); }}>
                    <option value="">{c.ct_state}</option>
                    {INDIAN_STATES.map(s=><option key={s} value={s} style={{color:'#111'}}>{s}</option>)}
                  </select>
                  <select style={{...leadInp, color: lead.city?'#111':'#9ca3af'}} value={lead.city}
                    onChange={e=>setL('city', e.target.value)} disabled={!lead.state}>
                    <option value="">{lead.state?c.ct_city:c.ct_cityfirst}</option>
                    {getCities(lead.state).map(ct=><option key={ct} value={ct} style={{color:'#111'}}>{ct}</option>)}
                  </select>
                </div>
                <textarea style={{...leadInp, minHeight:72, resize:'vertical', marginBottom:12}}
                  placeholder={c.ct_msg} value={lead.message}
                  onChange={e=>setL('message', e.target.value)}/>

                {leadState === 'error' && (
                  <div style={{background:'#fee2e2',color:'#991b1b',borderRadius:8,padding:'10px 12px',
                    fontSize:13,marginBottom:12,border:'1px solid #fca5a5'}}>
                    {c.ct_err}
                  </div>
                )}

                <button type="submit" disabled={leadState==='sending'}
                  style={{width:'100%',height:52,background:'#FF6B00',color:'#fff',border:'none',
                    borderRadius:10,fontSize:16,fontWeight:800,cursor:'pointer',
                    boxShadow:'0 4px 20px rgba(255,107,0,.35)'}}>
                  {leadState==='sending' ? c.ct_sending : c.ct_send}
                </button>
                <div style={{fontSize:12,color:'#888',textAlign:'center',marginTop:10}}>
                  {c.ct_note}
                </div>
              </>
            )}
          </form>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{background:'#04100A',color:'rgba(255,255,255,.4)',
        padding:'1.5rem 5%',display:'flex',justifyContent:'space-between',
        alignItems:'center',flexWrap:'wrap',gap:8,fontSize:13}}>
        <div>
          <span style={{fontWeight:900,color:'#fff'}}>
            <span style={{color:'#FF6B00'}}>pump</span><span style={{color:'#4DC3E8'}}>ini</span>
          </span>
          {' '}© 2026 · {c.hero} {c.hero2}
        </div>
        <div style={{display:'flex',gap:'1.5rem'}}>
          <Link href="/login"   style={{color:'rgba(255,255,255,.4)',textDecoration:'none'}}>{c.login}</Link>
          <Link href="/landing" style={{color:'rgba(255,255,255,.4)',textDecoration:'none'}}>{c.home}</Link>
        </div>
      </footer>

    </div>
  );
}
