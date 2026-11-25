# Admin guide

For admins and superadmins: the request form, categories, email, Slack,
IAM, people and the audit log. Roles come from the sign-in provider's groups
([Identity and access](identity-and-access.md)).

## First steps

1. Sign in with an address in `SUPERADMIN_EMAILS` (or as a member of the
   superadmin group).
2. **Integrations** (superadmins): set up email, so requesters hear about
   their requests, and Slack, if you want new tickets in a channel. Whoever
   runs the server can set email, Slack and IAM with `cli settings` instead
   ([Deployment](deployment.md#settings-from-the-command-line)).
3. **Request form → Categories**: name the kinds of requests you handle,
   e.g. "IT", "Finance", "Office". Optionally give each a default assignee.
4. **Request form → Questions**: ask what you need to know, with show-if
   rules for questions that only matter in some cases.
5. Send a test request as a requester and work on it on the **Board**.

## The request form

There is one form. It has pages; requesters see one page at a time, then
check their answers and send them.

- **The first page** always holds three questions that every ticket needs:
  the title, the category and the urgency. You can change their wording and
  order, not remove them.
- **Language:** English or German. Requesters see the form's buttons,
  messages and urgencies in it; write the questions in it too. The rest of
  the app, emails and Slack messages are in English.
- **Question types:** short text, long text, single choice, multiple
  choice, date, number, email, checkbox (for "I confirm …") and files.
- **Show if:** a page or question can appear only when earlier answers
  match, e.g. a page "Laptop" only when the category is "IT", or a question
  "Why is it urgent?" only when the urgency is "Very urgent". Rules can refer
  only to questions that come earlier. A hidden question is never required,
  and answers to it are not kept.
- **Saving publishes** a new version at once. Tickets keep the questions and
  answers as they were asked, so changing the form never changes old
  tickets. When someone else saved in between, reload first.

## Categories

The answers to the category question, and the filter on the board. A
**default assignee** gets every new ticket of the category (and an email or
Slack message about it). An inactive category is no longer offered, but its
tickets keep it. At least one category stays active.

## Working on tickets

- **Board:** one column per status. Drag a card to change its status or its
  order in the column; each card's menu does the same with the keyboard.
  Done and canceled show the last 14 days; the **All tickets** list shows
  everything.
- **A ticket** has its answers, the conversation and its activity. **Reply
  to requester** sends the requester an email; an **internal note** stays
  with staff (also its files). Change the status, urgency, category,
  assignee and due date on the side.
- **Waiting for requester:** a reply of the requester moves the ticket back
  to In progress.
- **Done:** the requester gets an email. A reply within 14 days reopens the
  ticket; after that, or when it was canceled, they send a new request.
- **New ticket:** record a request for someone, e.g. after a phone call.
  The requester gets the same email as for the form.

- **Identity requests:** when [IAM](https://github.com/projecttogether/iam)
  is connected (below), staff ask IAM for a new person from a ticket:
  **Request identity** opens a form
  filled in from the ticket's answers; check it, complete it (e.g. the
  personal email from the contract) and send it. IAM's approvers add the
  person, link someone who is already there, or reject the request. The
  ticket shows what became of it (asked every 5 minutes): approved with the
  work email, rejected with the reason, and when the accounts are ready. An
  open request can be cancelled from the ticket. When IAM does not answer
  clearly (it is down, or the answer gets lost), the request is kept as
  **Not confirmed by IAM yet**: **Send again** on the ticket, or the
  helpdesk itself every 5 minutes, sends it with the details first saved, so
  IAM gets one request. After a day without IAM's confirmation, Sentry
  reports it once. A request IAM refuses shows as **Refused by IAM** with the
  reason; send a corrected one.

## Notifications

| Who           | When                                                                | How                              |
| ------------- | ------------------------------------------------------------------- | -------------------------------- |
| Requester     | The request was received, staff replied, the ticket is done         | Email                            |
| Slack channel | A new ticket; a requester replied to a ticket nobody is assigned to | Slack                            |
| Assignee      | A ticket was assigned to them; the requester replied                | Email, or Slack if they chose it |

Each person chooses email or Slack in **My settings**. A Slack direct
message needs a Slack account with the same email address; otherwise the
message goes by email. Staff get no message about their own changes.

## Email (superadmins)

- **SMTP:** host, port, security (TLS on port 465, STARTTLS on 587), user
  and password of your mail server.
- **MailerSend:** an API token with permission to send email, and a sender
  address on a domain verified in MailerSend.

Send a test email after saving. Emails say that replies to them are not
read: people reply in the app.

## IAM (superadmins)

Staff can then request identities from tickets (above).

1. In IAM, **Admin › Settings › Identity requests**: choose the person types
   other apps may request (employee, intern, freelancer, volunteer,
   external).
2. In IAM, **Admin › API keys**: create a key named after the helpdesk and
   copy it.
3. Here, under **Integrations › IAM**: enter IAM's address and the
   key, and choose which questions of the form fill in which field (first
   name, last name, person type, start date, …). Save, then **Test
   connection**: it lists the person types IAM accepts.

Every operator, admin and superadmin can send requests. Staff check each
request before it goes to IAM; IAM's approvers decide. To stop, remove the
key here or revoke it in IAM. A new address needs the key again: the stored
key goes only to the address it was entered for.

## Slack (superadmins)

1. At https://api.slack.com/apps create an app **from scratch** in your
   workspace.
2. Under **OAuth & Permissions → Bot Token Scopes** add `chat:write`,
   `users:read`, `users:read.email`, and for the channel picker
   `channels:read` and `groups:read`.
3. **Install to Workspace** and copy the **Bot User OAuth Token**
   (`xoxb-…`) into the app.
4. Invite the bot to the channel for new tickets (`/invite @<bot name>`)
   and choose that channel.
5. Post a test message.

## People

The **People** page lists everyone the app knows, with their role and where
it came from (directory sync, sign-in or `SUPERADMIN_EMAILS`). Roles change
in the sign-in provider, not here. With Keycloak, superadmins can check the
connection and sync now.

## Audit log

Superadmins see who changed the form, categories, email, Slack, IAM and the
directory sync, and when.
Changes made on the server with `cli settings` show `operator` as the actor
and the command after the summary. It never holds passwords or tokens.
