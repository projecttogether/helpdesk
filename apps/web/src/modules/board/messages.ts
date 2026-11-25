import { defineMessages } from "@/i18n";

export const messages = defineMessages({
  en: {
    title: "Board",
    description: "Every ticket by status. Drag a card, or use its … menu.",
    newTicket: "New ticket",
    loading: "Loading the board…",
    updating: "Updating…",
    noMatches: "No tickets match the filters.",
    boardLabel: "Ticket board",

    ticketCount: "{count} tickets",
    ticketCount_one: "1 ticket",
    recentOnly: "Closed in the last {days} days.",
    showAll: "Show all",
    showing: "Showing {shown} of {total}",
    emptyColumn: "No tickets",

    unassigned: "Unassigned",
    assignedTo: "Assigned to {name}",
    due: "Due {date}",
    dueOverdue: "Overdue since {date}",
    messageCount: "{count} messages",
    messageCount_one: "1 message",
    cardMenu: "Actions for ticket #{number}",
    assignToMe: "Assign to me",
    moveTo: "Move to {status}",
    moved: "#{number} moved to {status}",
    assignedToYou: "#{number} is now assigned to you",
    moveStale: "Someone else changed #{number} meanwhile. The board now shows the latest state.",
    moveFailed: "#{number} could not be moved: {message}",

    dndInstructions:
      "To move a ticket, focus it and press Space. Arrow keys move it: left and right to another column, up and down within the column. Press Space again to drop it, or Escape to cancel. Enter opens the ticket.",
    dndPickedUp: "Picked up ticket #{number}. It is in {column}, position {position} of {count}.",
    dndOver: "Ticket #{number} is over {column}, position {position} of {count}.",
    dndNotOver: "Ticket #{number} is not over a column.",
    dndDropped: "Dropped ticket #{number} in {column}, position {position} of {count}.",
    dndCancelled: "Moving ticket #{number} was canceled. It stays in {column}.",
  },
});
