import type { EmailCopy } from "./en.js";

export const esEmailCopy: EmailCopy = {
  otp: {
    signInPreview: "Tu c\u00f3digo de inicio de sesi\u00f3n: {otp}",
    emailVerificationPreview: "Tu c\u00f3digo de verificaci\u00f3n: {otp}",
    signInTitle: "Inicia sesi\u00f3n con tu c\u00f3digo",
    emailVerificationTitle: "Tu c\u00f3digo de verificaci\u00f3n",
    signInDescription: "completar tu inicio de sesi\u00f3n",
    emailVerificationDescription: "verificar tu email",
    bodyIntro:
      "Usa el c\u00f3digo de verificaci\u00f3n a continuaci\u00f3n para {description}. Este c\u00f3digo es de un solo uso y caduca pronto.",
    codeLabel: "C\u00f3digo de verificaci\u00f3n",
    codeHint:
      "Introduce este c\u00f3digo en la ventana de inicio de sesi\u00f3n para continuar.",
    importantTitle: "Importante",
    expiresIn:
      "Este c\u00f3digo caduca en {minutes} minutos por motivos de seguridad.",
    ignore:
      "Si no solicitaste este c\u00f3digo, puedes ignorar este email con seguridad.",
    subjectSignIn: "Tu c\u00f3digo de inicio de sesi\u00f3n",
    subjectEmailVerification: "Tu c\u00f3digo de verificaci\u00f3n",
  },
  emailVerification: {
    preview: "Verifica tu email para {appName}",
    heading: "Verifica tu direcci\u00f3n de email",
    greeting: "Hola{userName}",
    intro:
      "\u00a1Gracias por registrarte! Haz clic en el bot\u00f3n para verificar tu email y completar la configuraci\u00f3n de tu cuenta.",
    button: "Verificar email",
    copyUrl: "O copia y pega esta URL en tu navegador:",
    expires:
      "Este enlace de verificaci\u00f3n caduca en 24 horas por motivos de seguridad.",
    ignore:
      "Si no creaste una cuenta con nosotros, puedes ignorar este email con seguridad.",
    subject: "Verifica tu direcci\u00f3n de email",
  },
  platformInvitation: {
    preview: "Est\u00e1s invitado a unirte a {appName}",
    heading: "Has sido invitado a unirte a {appName}",
    greeting: "Hola,",
    intro:
      "Un superadministrador te invit\u00f3 a crear una cuenta en {appName}. Usa el bot\u00f3n para abrir el registro y completarlo.",
    button: "Aceptar invitaci\u00f3n",
    copyUrl: "O copia y pega esta URL en tu navegador:",
    expires:
      "Esta invitaci\u00f3n caduca en {days} d\u00edas. Si no esperabas este email, puedes ignorarlo.",
    subject: "Tu invitaci\u00f3n a {appName}",
  },
};
