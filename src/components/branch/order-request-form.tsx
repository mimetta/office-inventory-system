"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { formatBaht } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

export type OrderItem = {
  id: string;
  name: string;
  category: string;
  current_stock: number;
  minimum_threshold: number;
  unit: string;
  max_request_qty: number | null;
  unit_price: number;
};

type Line = {
  key: number;
  custom: boolean;
  itemId: string;
  customName: string;
  quantity: string;
  note: string;
};

type PayloadLine = { item_id: string | null; item_name?: string; quantity: number; note: string };

type SummaryLine = {
  name: string;
  unit: string;
  quantity: number;
  unit_cost: number | null;
  total_cost: number | null;
  note: string;
};

const newLine = (key: number): Line => ({
  key,
  custom: false,
  itemId: "",
  customName: "",
  quantity: "1",
  note: "",
});

function stockBadge(item: OrderItem) {
  if (item.current_stock <= 0) return { text: "Out", className: "bg-red-50 text-red-700" };
  if (item.current_stock <= item.minimum_threshold) return { text: "Low", className: "bg-amber-50 text-amber-700" };
  return { text: "OK", className: "bg-emerald-50 text-emerald-700" };
}

function ItemPicker({
  items,
  selectedId,
  onSelect,
}: {
  items: OrderItem[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const selected = items.find((i) => i.id === selectedId);

  const q = text.trim().toLowerCase();
  const matches = items
    .filter((i) => !q || i.name.toLowerCase().includes(q) || (i.category ?? "").toLowerCase().includes(q))
    .slice(0, 50);

  return (
    <div className="relative">
      <Input
        value={open ? text : selected?.name ?? ""}
        placeholder="Search and choose an item"
        onFocus={() => {
          setText("");
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => setText(e.target.value)}
      />
      {open && (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-white shadow-lg">
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">No items match.</li>
          ) : (
            matches.map((item) => {
              const badge = stockBadge(item);
              return (
                <li
                  key={item.id}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSelect(item.id);
                    setOpen(false);
                    (document.activeElement as HTMLElement | null)?.blur();
                  }}
                  className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-slate-50"
                >
                  <span className="truncate">{item.name}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {item.current_stock} {item.unit} left
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}>
                      {badge.text}
                    </span>
                  </span>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}

function OrderSummary({ heading, lines }: { heading: string; lines: SummaryLine[] }) {
  const total = Math.round(lines.reduce((sum, l) => sum + (l.total_cost ?? 0), 0) * 100) / 100;
  const missing = lines.some((l) => l.total_cost === null);

  return (
    <div className="w-full rounded-md border bg-slate-50 p-3 text-left text-sm">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{heading}</p>
      <ul className="space-y-2">
        {lines.map((l, i) => (
          <li key={`${l.name}-${i}`} className="flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="font-medium text-slate-900">{l.name}</span>
              <span className="block text-xs text-muted-foreground">
                {l.quantity}
                {l.unit ? ` ${l.unit}` : ""}
                {l.unit_cost !== null ? ` × ${formatBaht(l.unit_cost)}` : ""}
              </span>
              {l.note ? <span className="block text-xs text-slate-600">Note: {l.note}</span> : null}
            </span>
            <span className="shrink-0 tabular-nums text-slate-900">
              {l.total_cost !== null ? (
                formatBaht(l.total_cost)
              ) : (
                <span className="text-xs text-muted-foreground">cost not set</span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex justify-between border-t pt-2 font-semibold text-slate-900">
        <span>Estimated total</span>
        <span className="tabular-nums">{formatBaht(total)}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Estimated from each item&apos;s current average cost. The real price is known when the admin buys the items.
        {missing ? " Items with no cost set are not included in the total." : ""}
      </p>
    </div>
  );
}

export function OrderRequestForm({
  branch,
  items,
  cutoffLabel,
}: {
  branch: string;
  items: OrderItem[];
  cutoffLabel: string;
}) {
  const keyCounter = useRef(1);
  const [lines, setLines] = useState<Line[]>([newLine(0)]);
  const [stage, setStage] = useState<"edit" | "review" | "done">("edit");
  const [pending, setPending] = useState<{ payload: PayloadLine[]; summary: SummaryLine[] } | null>(null);
  const [sentSummary, setSentSummary] = useState<SummaryLine[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const updateLine = (key: number, changes: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...changes } : l)));

  const addLine = () => {
    setLines((prev) => [...prev, newLine(keyCounter.current++)]);
  };

  const removeLine = (key: number) => setLines((prev) => prev.filter((l) => l.key !== key));

  // Step 1: check the form and show a summary. Nothing is sent yet.
  const review = () => {
    const payload: PayloadLine[] = [];
    const summary: SummaryLine[] = [];

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const qty = Number(l.quantity);
      const note = l.note.trim();

      if (!Number.isInteger(qty) || qty < 1) {
        toast.error(`Item ${i + 1}: quantity must be 1 or more`);
        return;
      }

      if (l.custom) {
        const name = l.customName.trim();
        if (name.length < 2) {
          toast.error(`Item ${i + 1}: please type the item name`);
          return;
        }
        payload.push({ item_id: null, item_name: name, quantity: qty, note });
        summary.push({ name, unit: "", quantity: qty, unit_cost: null, total_cost: null, note });
      } else {
        if (!l.itemId) {
          toast.error(`Item ${i + 1}: please choose an item`);
          return;
        }
        const picked = items.find((it) => it.id === l.itemId);
        if (!picked) {
          toast.error(`Item ${i + 1}: this item is no longer available`);
          return;
        }
        if (picked.max_request_qty) {
          const totalForItem = lines
            .filter((x) => !x.custom && x.itemId === l.itemId)
            .reduce((sum, x) => sum + (Number(x.quantity) || 0), 0);
          if (totalForItem > picked.max_request_qty) {
            toast.error(`${picked.name}: max ${picked.max_request_qty} ${picked.unit} per request`);
            return;
          }
        }
        const price = Number(picked.unit_price);
        const cost = price > 0 ? price : null;
        payload.push({ item_id: l.itemId, quantity: qty, note });
        summary.push({
          name: picked.name,
          unit: picked.unit,
          quantity: qty,
          unit_cost: cost,
          total_cost: cost === null ? null : Math.round(cost * qty * 100) / 100,
          note,
        });
      }
    }

    setPending({ payload, summary });
    setStage("review");
  };

  // Step 2: send it.
  const send = async () => {
    if (!pending) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/purchase-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch, lines: pending.payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to send request");

      toast.success("Order request sent.");
      setSentSummary(pending.summary);
      setPending(null);
      setLines([newLine(keyCounter.current++)]);
      setStage("done");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  if (stage === "done") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-lg font-medium text-slate-900">Request sent!</p>
          <p className="text-sm text-muted-foreground">
            The admin will review it after the {cutoffLabel} cut-off. You can follow its status in My History.
          </p>
          <OrderSummary heading="What you requested" lines={sentSummary} />
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => setStage("edit")}>Send another request</Button>
            <Link
              href={`/b/${branch}/history`}
              className="inline-flex h-10 items-center rounded-md border px-4 text-sm font-medium hover:bg-slate-50"
            >
              Open My History
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (stage === "review" && pending) {
    return (
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Check your request</h2>
            <p className="text-sm text-muted-foreground">Nothing has been sent yet.</p>
          </div>
          <OrderSummary heading="Your request" lines={pending.summary} />
          <div className="flex gap-2">
            <Button type="button" className="flex-1" disabled={submitting} onClick={send}>
              {submitting ? "Sending..." : "Send order request"}
            </Button>
            <Button type="button" variant="outline" disabled={submitting} onClick={() => setStage("edit")}>
              Back
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        {lines.map((line, index) => {
          const picked = line.custom ? null : items.find((it) => it.id === line.itemId);
          return (
            <div key={line.key} className="space-y-3 rounded-md border p-3">
              <div className="flex items-start justify-between gap-2">
                <Label className="text-xs text-muted-foreground">Item {index + 1}</Label>
                {lines.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="-mt-2 h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => removeLine(line.key)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>

              {line.custom ? (
                <Input
                  value={line.customName}
                  placeholder="Type the item name"
                  maxLength={100}
                  onChange={(e) => updateLine(line.key, { customName: e.target.value })}
                />
              ) : (
                <ItemPicker
                  items={items}
                  selectedId={line.itemId}
                  onSelect={(id) => updateLine(line.key, { itemId: id })}
                />
              )}

              <button
                type="button"
                className="text-xs font-medium text-teal-700 hover:underline"
                onClick={() => updateLine(line.key, { custom: !line.custom, itemId: "", customName: "" })}
              >
                {line.custom ? "Choose from the list instead" : "Item not in the list?"}
              </button>

              {picked?.max_request_qty ? (
                <p className="text-xs text-muted-foreground">
                  Max {picked.max_request_qty} {picked.unit} per request
                </p>
              ) : null}

              <div className="flex items-center gap-2">
                <Label htmlFor={`oq-${line.key}`} className="text-xs text-muted-foreground">
                  Qty
                </Label>
                <Input
                  id={`oq-${line.key}`}
                  type="number"
                  min={1}
                  className="h-9 w-24"
                  value={line.quantity}
                  onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                />
                {picked ? <span className="text-xs text-muted-foreground">{picked.unit}</span> : null}
              </div>

              <Input
                value={line.note}
                placeholder="Note (optional), e.g. brand, size or why you need it"
                maxLength={300}
                onChange={(e) => updateLine(line.key, { note: e.target.value })}
              />
            </div>
          );
        })}

        <Button type="button" variant="outline" size="sm" className="w-full gap-2" onClick={addLine}>
          <Plus className="h-4 w-4" /> Add another item
        </Button>

        <Button type="button" className="w-full" onClick={review}>
          Review request
        </Button>
      </CardContent>
    </Card>
  );
}