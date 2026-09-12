export const esAuth = {
  auth: {
    loginTitle: "Accede a tu cuenta.",
    loginDescription:
      "Inicia sesión en tu panel para gestionar tu cuenta y recursos.",
    signupTitle: "Crea tu cuenta.",
    signupDescription: "Comienza configurando tu perfil en segundos.",

    termsText: "Al registrarte, aceptas nuestros",
    termsOfService: "T\u00e9rminos de Servicio",
    and: "y la",
    privacyPolicy: "Pol\u00edtica de Privacidad",
    registrationClosed: "Registro cerrado",
    publicSignupUnavailable: "El registro p\u00fablico no est\u00e1 disponible",
    invitationRequired:
      "Se requiere una invitaci\u00f3n para crear una cuenta nueva.",
    invitationNote:
      "Solicita una invitaci\u00f3n a un administrador o inicia sesi\u00f3n con una cuenta existente.",
    goToLogin: "Ir al inicio de sesi\u00f3n",
    goToHomepage: "Ir al inicio",
    emailCode: "C\u00f3digo por email",
    alreadyHaveAccount: "\u00bfYa tienes una cuenta?",
    logIn: "Iniciar sesi\u00f3n",
    dontHaveAccount: "\u00bfNo tienes cuenta?",
    signUp: "Registrarse",
    signupClosedShort: "El registro p\u00fablico est\u00e1 cerrado.",
    fullNameLabel: "Nombre",
    emailLabel: "Email",
    enterNameAndEmail: "Ingresa tu nombre y email.",
    enterEmail: "Ingresa tu email.",
    fullNamePlaceholder: "Tu nombre completo",
    emailInputPlaceholder: "tu@empresa.com",
    sendCode: "Enviar c\u00f3digo",
    checkYourEmail: "Revisa tu email",
    codeIfUsableSentTo: "Si este email puede usarse, enviamos un c\u00f3digo a",
    backToEmail: "Volver al email",

    otpLabel: "C\u00f3digo de verificaci\u00f3n",
    enterCode: "Ingresa el c\u00f3digo de 6 d\u00edgitos",
    verifyCode: "Verificar c\u00f3digo",
    resendCodeIn: "Reenviar c\u00f3digo en",
    resendCodeSeconds: "s",
    resendCode: "Reenviar c\u00f3digo",
    tooManyAttempts:
      "Demasiados intentos fallidos. Por favor solicita un nuevo c\u00f3digo.",
    codeExpired: "El c\u00f3digo expir\u00f3. Por favor solicita uno nuevo.",
    otpSoftHintLogin: "\u00bfA\u00fan no tienes una cuenta?",
    otpSoftHintSignup: "\u00bfYa tienes una cuenta?",
    otpVerifyFailedLogin:
      "No se pudo verificar ese c\u00f3digo. Rev\u00edsalo, o reg\u00edstrate si a\u00fan no tienes una cuenta.",
    otpVerifyFailedSignup:
      "No se pudo verificar ese c\u00f3digo. Rev\u00edsalo, o inicia sesi\u00f3n si ya tienes una cuenta.",
    invalidCode: "C\u00f3digo de verificaci\u00f3n inv\u00e1lido",
    failedToVerify: "Error al verificar el c\u00f3digo",
    failedToSendOtp: "Error al enviar el OTP",
    failedToSendVerificationCode:
      "Error al enviar el c\u00f3digo de verificaci\u00f3n",

    somethingWentWrong:
      "Algo sali\u00f3 mal. Por favor int\u00e9ntalo de nuevo.",

    enterValidEmail: "Ingresa una direcci\u00f3n de email v\u00e1lida.",
    nameTooLong: "El nombre debe tener como m\u00e1ximo 128 caracteres.",
    nameRequired: "El nombre es requerido.",
    enterVerificationCode:
      "Ingresa el c\u00f3digo de verificaci\u00f3n de 6 d\u00edgitos.",

    authRequired: "Autenticaci\u00f3n requerida",
    signInToAccess: "Inicia sesi\u00f3n para acceder a esta p\u00e1gina.",
    signIn: "Iniciar sesi\u00f3n",
    somethingWentWrongTitle: "Algo sali\u00f3 mal",
  },

  verifyEmail: {
    shellTitle: "Verifica tu identidad y contin\u00faa.",
    shellDescription: "Confirma tu email para continuar a tu cuenta.",
    innerTitle: "Verificaci\u00f3n de email",
    verifying: "Verificando tu email...",
    invalidOrExpired:
      "Este enlace de verificaci\u00f3n es inv\u00e1lido o ha expirado.",
    missingInfo:
      "A este enlace de verificaci\u00f3n le falta informaci\u00f3n requerida.",
    success: "Tu direcci\u00f3n de email ha sido verificada.",
    buttonVerifying: "Verificando...",
    buttonContinue: "Continuar",
    buttonGoToLogin: "Ir al inicio de sesi\u00f3n",
    backToLogin: "Volver al inicio de sesi\u00f3n",
  },
} as const;
