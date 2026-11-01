// Fixed agent lines (PRD §13, Addendum G2, G5, G7, G9, G10, G11).
// PENDING IRB WORDING: every line here must be approved before a real caller
// hears it. The agent never says "eligible" and never gives medical advice.
import type { Lang } from "./types";

type Ctx = { shortName: string; questions: number; minutes: number; sitePhone: string; days: number };
type Line = (c: Ctx) => string;
type L = { en: Line; es: Line };
const t = (en: string | Line, es: string | Line): L => ({
  en: typeof en === "string" ? () => en : en,
  es: typeof es === "string" ? () => es : es,
});

export const LINES = {
  disclosure: t(
    (c) => `Hi, I'm an AI assistant for the ${c.shortName} study. I'll ask about ${c.questions} short questions to see if you might be a fit — about ${c.minutes} minutes. I can't give medical advice, and the study team makes the final decision. This call is recorded. Is it OK to start?`,
    (c) => `Hola, soy un asistente de inteligencia artificial del estudio ${c.shortName}. Le haré unas ${c.questions} preguntas cortas para ver si el estudio podría ser para usted, en unos ${c.minutes} minutos. No puedo dar consejos médicos, y el equipo del estudio toma la decisión final. Esta llamada se graba. ¿Está bien si empezamos?`,
  ),
  consentRetry: t("Sorry, I didn't catch that. Is it OK to start? You can say yes or no.", "Perdón, no le entendí. ¿Está bien si empezamos? Puede decir sí o no."),
  consentDeclined: t("No problem. You can call back anytime. Goodbye.", "Está bien. Puede llamar cuando quiera. Adiós."),

  whoFor: t(
    "Are you answering these questions for yourself, or for someone else, like a family member you help care for?",
    "¿Va a responder estas preguntas por usted mismo o por otra persona, como un familiar que usted cuida?",
  ),
  whoForPediatric: t("Are you a parent or guardian calling for a child?", "¿Es usted el padre, la madre o el tutor de un niño y llama por él?"),
  whoForRetry: t("Sorry — are these answers about you, or about someone else?", "Perdón, ¿las respuestas son sobre usted o sobre otra persona?"),
  relationship: t("What is your relationship to them?", "¿Qué relación tiene con esa persona?"),
  minorStop: t(
    "Thanks for calling. For anyone under 18, a parent or guardian needs to do this call. They can call this number anytime. Goodbye.",
    "Gracias por llamar. Para personas menores de 18 años, el padre, la madre o el tutor debe hacer esta llamada. Pueden llamar a este número cuando quieran. Adiós.",
  ),
  switchConfirm: t(
    "Just to check — should I ask about the person you're calling for instead of you?",
    "Solo para confirmar: ¿debo preguntar sobre la persona por la que llama en lugar de usted?",
  ),
  switchRestart: t("Okay. I'll start the questions again, about them.", "Está bien. Voy a empezar las preguntas de nuevo, sobre esa persona."),
  switchTwice: t("Let's start a new call so the answers stay clear. Please call back anytime. Goodbye.", "Mejor empecemos una llamada nueva para que las respuestas queden claras. Llame cuando quiera. Adiós."),

  notSure: t("That's fine — the study team can check that with you.", "Está bien, el equipo del estudio puede revisarlo con usted."),
  retry: t("Sorry, I didn't catch that.", "Perdón, no le entendí."),
  moveOn: t("Let's move on — the study team can check that with you.", "Sigamos. El equipo del estudio puede revisarlo con usted."),
  exactNumber: t("Could you tell me the exact number?", "¿Me podría decir el número exacto?"),
  askAgain: t("Okay, let me ask again.", "Está bien, le pregunto de nuevo."),
  firstQuestion: t("This is the first question.", "Esta es la primera pregunta."),
  goingBack: t("Okay, let's go back.", "Está bien, regresemos."),
  clarifyFallback: t(
    "That's a good question for the study team. Would you like to answer, or say 'not sure'?",
    "Esa es una buena pregunta para el equipo del estudio. ¿Quiere responder, o decir 'no estoy seguro'?",
  ),
  medical: t(
    "I can't give medical advice, and I can't answer questions about the study treatment. The study team will answer those.",
    "No puedo dar consejos médicos ni responder preguntas sobre el tratamiento del estudio. El equipo del estudio le contestará eso.",
  ),
  human: t(
    (c) => `I can't transfer calls, but you can reach the study team at ${c.sitePhone}. Let's keep going.`,
    (c) => `No puedo transferir llamadas, pero puede comunicarse con el equipo del estudio al ${c.sitePhone}. Sigamos.`,
  ),
  stopped: t("No problem. You can call back anytime. Goodbye.", "Está bien. Puede llamar cuando quiera. Adiós."),

  stillThere: t("Are you still there? Take your time.", "¿Sigue ahí? Tómese su tiempo."),
  silenceEnd: t("I'll end the call for now. You can call back anytime.", "Voy a terminar la llamada por ahora. Puede llamar cuando quiera."),
  almostOutOfTime: t("We're almost out of time.", "Ya casi se nos acaba el tiempo."),
  capEnd: t("We've reached the time limit for this call. The study team can finish with you. Goodbye.", "Llegamos al tiempo límite de esta llamada. El equipo del estudio puede terminar con usted. Adiós."),

  reviewAsk: t("Before we finish, is there any answer you'd like to change?", "Antes de terminar, ¿quiere cambiar alguna respuesta?"),
  reviewWhich: t("Which one? You can name the topic, like your age.", "¿Cuál? Puede decir el tema, por ejemplo, su edad."),
  reviewNoMatch: t("I couldn't tell which one. The study team can go over it with you.", "No pude saber cuál. El equipo del estudio puede revisarlo con usted."),
  reviewMore: t("Anything else you'd like to change?", "¿Algo más que quiera cambiar?"),

  // G2 closings — never "eligible".
  closeLikely: t(
    (c) => `Based on your answers, you may be a fit. The study team will contact you within ${c.days} business days to confirm.`,
    (c) => `Según sus respuestas, el estudio podría ser para usted. El equipo del estudio se comunicará con usted en ${c.days} días hábiles para confirmarlo.`,
  ),
  closeReview: t(
    (c) => `Thank you. A few answers need the study team to check. They'll contact you within ${c.days} business days.`,
    (c) => `Gracias. Algunas respuestas las tiene que revisar el equipo del estudio. Se comunicarán con usted en ${c.days} días hábiles.`,
  ),
  closeNotMatch: t(
    (c) => `Thank you for your time. From your answers, this study may not be a match. The study team reviews every call and will reach out if that changes. You can also reach them at ${c.sitePhone}. Goodbye.`,
    (c) => `Gracias por su tiempo. Según sus respuestas, puede que este estudio no sea para usted. El equipo del estudio revisa todas las llamadas y se comunicará si eso cambia. También puede llamarles al ${c.sitePhone}. Adiós.`,
  ),
  goodbye: t("Goodbye.", "Adiós."),

  // G11 contact capture
  contactAsk: t(
    "Would you like the study team to call you about next steps? If so, I'll need your first name and a phone number.",
    "¿Quiere que el equipo del estudio le llame sobre los siguientes pasos? Si es así, necesito su nombre y un número de teléfono.",
  ),
  contactAskProxy: t(
    "Would you like the study team to call you about next steps for the person you're calling for? If so, I'll need your first name and a phone number.",
    "¿Quiere que el equipo del estudio le llame sobre los siguientes pasos para la persona por la que llama? Si es así, necesito su nombre y un número de teléfono.",
  ),
  contactDeclined: t((c) => `That's fine. You can contact the study team at ${c.sitePhone}.`, (c) => `Está bien. Puede comunicarse con el equipo del estudio al ${c.sitePhone}.`),
  askName: t("What's your first name?", "¿Cuál es su nombre?"),
  askPhone: t("What's the best phone number to reach you?", "¿Cuál es el mejor número de teléfono para comunicarnos con usted?"),
  phoneShort: t("I got fewer digits than I expected. Could you say the full number again?", "Recibí menos dígitos de los que esperaba. ¿Me puede decir el número completo otra vez?"),
  phoneType: t("You can also type it in the box on your screen.", "También puede escribirlo en el cuadro de su pantalla."),
  phoneGiveUp: t((c) => `Sorry, I couldn't get the number. You can contact the study team at ${c.sitePhone}.`, (c) => `Perdón, no pude anotar el número. Puede comunicarse con el equipo del estudio al ${c.sitePhone}.`),
  voicemail: t("If we miss you, is it OK to leave a message that mentions this study?", "Si no le encontramos, ¿podemos dejarle un mensaje que mencione este estudio?"),
  bestTime: t("What's the best time to call: morning, afternoon, or evening?", "¿Cuál es la mejor hora para llamarle: en la mañana, la tarde o la noche?"),

  // G9 red flags — stop the screener.
  happeningNow: t("Is this happening to you right now?", "¿Esto le está pasando ahora mismo?"),
  happeningNowProxy: t("Is this happening right now, to you or the person you care for?", "¿Esto está pasando ahora mismo, a usted o a la persona que cuida?"),
  emergency: t(
    "I need to stop the questions. If this is happening now, please hang up and call 911 or go to the nearest emergency room.",
    "Tengo que detener las preguntas. Si esto está pasando ahora, por favor cuelgue y llame al 911 o vaya a la sala de emergencias más cercana.",
  ),
  emergencyProxy: t(
    "I need to stop the questions. If this is happening now to you or the person you care for, please hang up and call 911 or go to the nearest emergency room.",
    "Tengo que detener las preguntas. Si esto le está pasando ahora a usted o a la persona que cuida, por favor cuelgue y llame al 911 o vaya a la sala de emergencias más cercana.",
  ),
  crisis: t(
    "I need to stop the questions. You can call or text 988 to reach the Suicide and Crisis Lifeline any time. If you're in danger now, call 911.",
    "Tengo que detener las preguntas. Puede llamar o enviar un mensaje de texto al 988 para comunicarse con la Línea de Prevención del Suicidio y Crisis en cualquier momento. Si está en peligro ahora, llame al 911.",
  ),
} satisfies Record<string, L>;

export type LineKey = keyof typeof LINES;

export function line(key: LineKey, lang: Lang, ctx: Ctx): string {
  return LINES[key][lang](ctx);
}

export type LineCtx = Ctx;
