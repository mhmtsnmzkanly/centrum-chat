export const DEFAULT_LOCALE = "en";

export const AUTH_CATALOGS = {
  en: {
    title: "Welcome to your workspace", "nav.signIn": "Sign in", "nav.register": "Create account",
    "resolving.title": "Restoring your session", "resolving.body": "Please wait while we securely check this browser.",
    "signIn.title": "Sign in", "signIn.body": "Continue to chat or the Control Center.",
    "register.title": "Create your account", "register.body": "Start with the credentials used to secure your account.",
    "steps.account": "Step 1 of 3 · Account", "steps.preferences": "Step 2 of 3 · Profile and preferences", "steps.verification": "Step 3 of 3 · Email verification",
    "preferences.title": "Make CentrumChat yours", "preferences.body": "These choices are saved to your account and can be changed later.",
    "verification.title": "Verify your email", "verification.address": "We sent a verification link to", "verification.body": "The link expires. You can request a fresh link if needed; setup finishes only after the server confirms verification.",
    "resetRequest.title": "Reset your password", "resetRequest.body": "The response is the same whether or not an account exists.", "resetComplete.title": "Choose a new password",
    "permission.title": "Control Center permission required", "permission.body": "You are authenticated, but the backend did not grant this account Control Center access.",
    "redirect.title": "Opening CentrumChat", "fatal.title": "We could not continue",
    "fields.identity": "Username or email", "fields.username": "Username", "fields.displayName": "Display name", "fields.email": "Email address", "fields.password": "Password", "fields.newPassword": "New password", "fields.confirmPassword": "Confirm new password", "fields.remember": "Remember me on this browser", "fields.bio": "Bio", "fields.avatar": "Prepared avatar", "fields.cover": "Prepared cover", "fields.nameColor": "Name color", "fields.theme": "Theme", "fields.dmPrivacy": "Who may start a direct message?", "fields.groupPrivacy": "Who may add you to a group?", "fields.sound": "Play message sounds", "fields.desktopNotifications": "Enable desktop notifications",
    "hints.identity": "Use the username or email attached to your account.", "hints.username": "3–20 letters, numbers, or underscores.", "hints.password": "Use at least 8 characters.", "hints.bio": "A short introduction, up to 280 characters.", "hints.dmPrivacy": "This controls new direct interactions, not existing history.", "hints.notification": "Permission is requested only when you press this button. A denial will not block setup.",
    "privacy.title": "Privacy choices", "privacy.everyone": "Everyone", "privacy.groupMembers": "People sharing a group with me", "privacy.dmContacts": "People with an existing direct conversation", "privacy.noOne": "No one",
    "options.dark": "Dark", "options.light": "Light", "options.cover": "Cover {number}",
    "actions.showPassword": "Show", "actions.hidePassword": "Hide", "actions.signIn": "Sign in", "actions.createAccount": "Create account", "actions.forgotPassword": "Forgot your password?", "actions.requestNotification": "Request browser notification permission", "actions.saveContinue": "Save and continue", "actions.signOut": "Sign out", "actions.checkedEmail": "I verified my email", "actions.resend": "Resend verification email", "actions.sendReset": "Send reset email", "actions.backSignIn": "Back to sign in", "actions.resetPassword": "Reset password", "actions.goChat": "Go to chat",
    "status.resetSent": "If the address belongs to an account, a reset email has been sent.", "status.resetComplete": "Password reset complete. Sign in with your new password.", "status.verificationSent": "A fresh verification email was requested.", "status.notificationGranted": "Browser notification permission granted.", "status.notificationDenied": "Browser notification permission was not granted; you can still finish setup.", "status.emailVerified": "Email verified successfully.", "status.emailChanged": "Email address changed successfully.",
    "errors.required": "Complete the required fields.", "errors.passwordMismatch": "The passwords do not match.", "errors.session": "Your session could not be restored. Please sign in.", "errors.generic": "The request could not be completed. Try again.", "errors.permission": "This account does not have Control Center permission.",
  },
  tr: {
    title: "Çalışma alanına hoş geldin", "nav.signIn": "Giriş yap", "nav.register": "Hesap oluştur",
    "resolving.title": "Oturum geri yükleniyor", "resolving.body": "Bu tarayıcı güvenli biçimde kontrol edilirken bekleyin.",
    "signIn.title": "Giriş yap", "signIn.body": "Sohbete veya Control Center’a devam edin.",
    "register.title": "Hesabını oluştur", "register.body": "Hesabını koruyacak bilgilerle başla.",
    "steps.account": "Adım 1 / 3 · Hesap", "steps.preferences": "Adım 2 / 3 · Profil ve tercihler", "steps.verification": "Adım 3 / 3 · E-posta doğrulama",
    "preferences.title": "CentrumChat’i kendine göre ayarla", "preferences.body": "Bu seçimler hesabına kaydedilir ve daha sonra değiştirilebilir.",
    "verification.title": "E-postanı doğrula", "verification.address": "Doğrulama bağlantısını şu adrese gönderdik:", "verification.body": "Bağlantının süresi dolar. Gerekirse yenisini isteyebilirsin; sunucu doğrulamayı onaylamadan kurulum tamamlanmaz.",
    "resetRequest.title": "Parolanı sıfırla", "resetRequest.body": "Yanıt, hesabın var olup olmamasından bağımsız olarak aynıdır.", "resetComplete.title": "Yeni parola seç",
    "permission.title": "Control Center yetkisi gerekli", "permission.body": "Oturum açık ancak backend bu hesaba Control Center erişimi vermedi.",
    "redirect.title": "CentrumChat açılıyor", "fatal.title": "Devam edemedik",
    "actions.signIn": "Giriş yap", "actions.createAccount": "Hesap oluştur", "actions.signOut": "Çıkış yap", "actions.goChat": "Sohbete git", "actions.backSignIn": "Girişe dön",
  },
};

export function createAuthTranslator(requestedLocale) {
  const locale = AUTH_CATALOGS[requestedLocale] ? requestedLocale : DEFAULT_LOCALE;
  return {
    locale,
    text(key, values = {}) {
      const template = AUTH_CATALOGS[locale]?.[key] ??
        AUTH_CATALOGS[DEFAULT_LOCALE]?.[key] ?? key;
      return Object.entries(values).reduce(
        (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
        template,
      );
    },
  };
}
