import { defineMessages } from "@/i18n";

export const messages = defineMessages({
  en: {
    title: "My settings",
    description: "Your account and how the helpdesk reaches you.",
    account: "Account",
    accountHint:
      "Your name, email and role come from your organization's sign-in. Your role follows your groups there; ask your IT team to change it.",
    name: "Name",
    email: "Email",
    role: "Role",
    notifications: "Notifications",
    notifyQuestion: "How do you want to hear about tickets assigned to you and replies from requesters?",
    notifyEmail: "Email",
    notifyEmailHint: "To {email}.",
    notifySlack: "Slack direct message",
    notifySlackHint: "From the helpdesk's Slack bot. Your Slack account must use the same email address.",
    slackUnavailable: "Slack isn't set up for the helpdesk yet.",
    slackFallback: "Slack isn't connected right now, so you get emails until it is.",
    requesterNote: "You get emails about your requests: when they're received, answered and done.",
    about: "Helpdesk is ProjectTogether's open-source helpdesk for internal requests.",
  },
});
