import { useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { QueryKey } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  DndContext,
  DragOverlay,
  KeyboardCode,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type PointerSensorOptions,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Board, TicketSummary } from "@helpdesk/shared/api/tickets";
import { BOARD_CLOSED_DAYS, STATUSES, isClosed, type Status } from "@helpdesk/shared/tickets";
import { useMe } from "@/hooks/use-me";
import { useT } from "@/i18n";
import { useStatusLabel } from "@/lib/labels";
import { cn } from "@/components/ui/utils";
import { useUpdateTicket } from "@/modules/tickets/api";
import { StatusDot } from "@/modules/tickets/bits";
import { useMoveTicket } from "./api";
import { applyMove, columnIds, columnOf, dragOver, dropPosition, type ColumnIds } from "./board-state";
import { messages } from "./messages";
import { CardSlot, TicketCard, type CardActions } from "./ticket-card";

/**
 * Mouse and pen drags start after a few pixels, so a click still opens the
 * card. Touch is left to the TouchSensor (press and hold), so swiping
 * scrolls the board.
 */
class MousePointerSensor extends PointerSensor {
  static override activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent: event }: ReactPointerEvent, { onActivation }: PointerSensorOptions) => {
        if (event.pointerType === "touch" || !event.isPrimary || event.button !== 0) return false;
        onActivation?.({ event });
        return true;
      },
    },
  ];
}

/** Space picks a card up and drops it; Enter on the card's link still opens the ticket. */
const KEYBOARD_CODES = {
  start: [KeyboardCode.Space],
  cancel: [KeyboardCode.Esc],
  end: [KeyboardCode.Space, KeyboardCode.Enter],
};

const asId = (id: UniqueIdentifier) => String(id);

/**
 * Arrow keys while a card is picked up: Left and Right go to the previous and
 * next column, Up and Down move within the column.
 */
function boardKeyboardCoordinates(layout: { current: ColumnIds }): KeyboardCoordinateGetter {
  return (event, args) => {
    const step = event.code === KeyboardCode.Right ? 1 : event.code === KeyboardCode.Left ? -1 : 0;
    if (step === 0) return sortableKeyboardCoordinates(event, args);
    const { active, collisionRect, droppableRects, over } = args.context;
    if (!active || !collisionRect) return undefined;
    const current = columnOf(layout.current, asId(over?.id ?? active.id));
    const target = current ? STATUSES[STATUSES.indexOf(current) + step] : undefined;
    const rect = target ? droppableRects.get(target) : undefined;
    if (!rect) return undefined;
    event.preventDefault();
    // The top of the target column, where it is closer than any of its cards.
    return { x: rect.left + (rect.width - collisionRect.width) / 2, y: rect.top };
  };
}

function SortableTicket(props: { ticket: TicketSummary; actions: CardActions }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.ticket.id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className="touch-manipulation"
      {...listeners}
    >
      <TicketCard
        ticket={props.ticket}
        actions={props.actions}
        linkRef={setActivatorNodeRef}
        // The link stays a link (Enter opens it); the instructions tell how to move it.
        linkProps={{ "aria-describedby": attributes["aria-describedby"] }}
        placeholder={isDragging}
      />
    </li>
  );
}

function Column(props: {
  status: Status;
  total: number;
  ids: string[];
  tickets: Map<string, TicketSummary>;
  actions: (ticket: TicketSummary) => CardActions;
  /** A dragged card from another column is over this one. */
  target: boolean;
}) {
  const t = useT(messages);
  const statusLabel = useStatusLabel();
  const headingId = useId();
  const { setNodeRef, isOver } = useDroppable({ id: props.status });
  const closed = isClosed(props.status);
  const shown = props.ids.length;
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "bg-muted/50 flex max-w-96 min-w-[16.5rem] flex-1 basis-0 flex-col rounded-xl border transition-shadow md:max-h-[calc(100dvh-15rem)] md:min-h-80",
        props.target && "ring-ring/40 ring-2",
      )}
    >
      <header className="grid gap-1 px-3 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <StatusDot status={props.status} className="size-2.5" />
          <h2 id={headingId} className="min-w-0 truncate text-sm font-semibold">
            {statusLabel(props.status)}
          </h2>
          <span
            className="bg-background text-muted-foreground ml-auto rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums"
            title={t("ticketCount", { count: props.total })}
          >
            <span aria-hidden>{props.total}</span>
            <span className="sr-only">{t("ticketCount", { count: props.total })}</span>
          </span>
        </div>
        {closed ? (
          <p className="text-muted-foreground text-xs">
            {t("recentOnly", { days: BOARD_CLOSED_DAYS })}{" "}
            <Link
              to="/tickets"
              search={{ status: props.status }}
              className="hover:text-foreground underline underline-offset-2"
            >
              {t("showAll")}
            </Link>
          </p>
        ) : props.total > shown && shown > 0 ? (
          <p className="text-muted-foreground text-xs">{t("showing", { shown, total: props.total })}</p>
        ) : null}
      </header>
      <SortableContext id={props.status} items={props.ids} strategy={verticalListSortingStrategy}>
        <ol
          ref={setNodeRef}
          className={cn(
            "flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto rounded-b-xl px-2 pt-1 pb-2 transition-colors",
            isOver && "bg-accent/60",
          )}
        >
          {props.ids.length === 0 ? <CardSlot>{t("emptyColumn")}</CardSlot> : null}
          {props.ids.map((id) => {
            const ticket = props.tickets.get(id);
            return ticket ? (
              <SortableTicket key={id} ticket={ticket} actions={props.actions(ticket)} />
            ) : null;
          })}
        </ol>
      </SortableContext>
    </section>
  );
}

/**
 * The board: a column per status. Tickets move by drag and drop (mouse,
 * touch with a long press, or keyboard, announced to screen readers) or
 * through each card's "…" menu.
 */
export function BoardView({ board, queryKey }: { board: Board; queryKey: QueryKey }) {
  const t = useT(messages);
  const statusLabel = useStatusLabel();
  const me = useMe();
  const move = useMoveTicket(queryKey);
  const update = useUpdateTicket();
  const [dragIds, setDragIds] = useState<ColumnIds | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const layout = useRef<ColumnIds>(columnIds(board));
  const sensors = useSensors(
    useSensor(MousePointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: boardKeyboardCoordinates(layout),
      keyboardCodes: KEYBOARD_CODES,
    }),
  );

  const tickets = useMemo(
    () =>
      new Map(
        board.columns.flatMap((column) => column.tickets.map((ticket) => [ticket.id, ticket] as const)),
      ),
    [board],
  );
  const baseIds = useMemo(() => columnIds(board), [board]);
  const ids = dragIds ?? baseIds;
  layout.current = ids;
  const totals = Object.fromEntries(board.columns.map((column) => [column.status, column.total])) as Partial<
    Record<Status, number>
  >;

  const moveTo = (ticket: TicketSummary, status: Status, index: number | "end") => {
    const result = applyMove(board, ticket.id, status, index);
    if (result) move.mutate({ ticket, status, board: result.board, order: result.order });
  };

  const actions = (ticket: TicketSummary): CardActions => ({
    onMove: (status) => {
      moveTo(ticket, status, "end");
      toast.success(t("moved", { number: ticket.number, status: statusLabel(status) }));
    },
    onAssignToMe:
      ticket.assignee?.id === me.id
        ? undefined
        : () =>
            update.mutate(
              {
                number: ticket.number,
                revision: ticket.revision,
                change: { assignee: { id: me.id, name: me.name, email: me.email } },
              },
              { onSuccess: () => toast.success(t("assignedToYou", { number: ticket.number })) },
            ),
  });

  const placeOf = (map: ColumnIds, id: string) => {
    const status = columnOf(map, id);
    const list = status ? map[status] : [];
    const index = list.indexOf(id);
    return {
      column: status ? statusLabel(status) : "",
      position: index >= 0 ? index + 1 : list.length + 1,
      count: list.length,
    };
  };
  const numberOf = (id: UniqueIdentifier) => tickets.get(asId(id))?.number ?? "";
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      t("dndPickedUp", { number: numberOf(active.id), ...placeOf(baseIds, asId(active.id)) }),
    onDragOver: ({ active, over }) =>
      over
        ? t("dndOver", { number: numberOf(active.id), ...placeOf(ids, asId(over.id)) })
        : t("dndNotOver", { number: numberOf(active.id) }),
    onDragEnd: ({ active, over }) =>
      over
        ? t("dndDropped", { number: numberOf(active.id), ...placeOf(ids, asId(active.id)) })
        : t("dndCancelled", {
            number: numberOf(active.id),
            column: placeOf(baseIds, asId(active.id)).column,
          }),
    onDragCancel: ({ active }) =>
      t("dndCancelled", { number: numberOf(active.id), column: placeOf(baseIds, asId(active.id)).column }),
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    setActiveId(asId(active.id));
    setDragIds(baseIds);
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    setDragIds((current) => (current ? dragOver(current, asId(active.id), asId(over.id)) : current));
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const current = dragIds;
    setDragIds(null);
    setActiveId(null);
    const id = asId(active.id);
    const ticket = tickets.get(id);
    if (!over || !current || !ticket) return;
    const position = dropPosition(current, id, asId(over.id));
    if (!position) return;
    if (position.status === ticket.status) {
      // Done and cancelled are sorted by closing time; their order can't change.
      if (isClosed(position.status) || position.index === baseIds[position.status].indexOf(id)) return;
    }
    moveTo(ticket, position.status, position.index);
  };

  const active = activeId ? tickets.get(activeId) : undefined;
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setDragIds(null);
        setActiveId(null);
      }}
      accessibility={{ announcements, screenReaderInstructions: { draggable: t("dndInstructions") } }}
    >
      {/* `relative` keeps visually hidden text of off-screen columns inside the scroll area. */}
      <div
        role="region"
        aria-label={t("boardLabel")}
        tabIndex={0}
        className="focus-visible:ring-ring/50 relative -mx-4 overflow-x-auto px-4 pb-3 focus-visible:ring-[3px] focus-visible:outline-none md:-mx-6 md:px-6"
      >
        <div className="flex items-stretch gap-3 md:items-start">
          {STATUSES.map((status) => (
            <Column
              key={status}
              status={status}
              total={totals[status] ?? 0}
              ids={ids[status]}
              target={active !== undefined && active.status !== status && ids[status].includes(active.id)}
              tickets={tickets}
              actions={actions}
            />
          ))}
        </div>
      </div>
      <DragOverlay>{active ? <TicketCard ticket={active} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}
