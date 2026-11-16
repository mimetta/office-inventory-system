import { createServiceClient } from "@/lib/supabase/service";
import { isBranch } from "@/lib/branches";
import { formatBaht } from "@/lib/money";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

export const dynamic = "force-dynamic";

const TZ = "Asia/Bangkok";
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

type Related<T> = T | T[] | null;

type WithdrawalRow = {
  item_id: string;
  quantity: number;
  branch: string | null;
  department: string | null;
  total_cost: number | string | null;
  items: Related<{ name: string; unit: string }>;
};

function one<T>(value: Related<T> | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function thisMonth() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" }).formatToParts(
    new Date()
  );
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${y}-${m}`;
}

function shiftMonth(ym: string, delta: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
}

const branchLabel = (b: string) => (b === "factory" ? "Factory" : b === "office" ? "Office" : "Unknown branch");
const money = (value: number) => formatBaht(Math.round(value * 100) / 100);

type Line = { label: string; count: number; cost: number };

function SummaryTable({ title, firstHead, rows }: { title: string; firstHead: string; rows: Line[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No withdrawals in this selection.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{firstHead}</TableHead>
                <TableHead className="text-right">Withdrawals</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.label}>
                  <TableCell className="font-medium">{r.label}</TableCell>
                  <TableCell className="text-right">{r.count}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.cost)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default async function SpendingPage({ searchParams }: { searchParams: { month?: string; branch?: string } }) {
  const now = thisMonth();
  const month =
    searchParams.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(searchParams.month) ? searchParams.month : now;
  const branch = searchParams.branch && isBranch(searchParams.branch) ? searchParams.branch : "all";

  // Month boundaries in Bangkok time, sent to the database as exact moments.
  const start = new Date(`${month}-01T00:00:00+07:00`).toISOString();
  const end = new Date(`${shiftMonth(month, 1)}-01T00:00:00+07:00`).toISOString();

  const monthOptions = Array.from({ length: 13 }, (_, i) => shiftMonth(now, -i));
  if (!monthOptions.includes(month)) monthOptions.push(month);

  const service = createServiceClient();

  // The database returns at most 1000 rows at a time, so read it page by page.
  const rows: WithdrawalRow[] = [];
  let loadFailed = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    let query = service
      .from("withdrawals")
      .select("item_id, quantity, branch, department, total_cost, items(name, unit)")
      .eq("status", "completed")
      .gte("requested_at", start)
      .lt("requested_at", end)
      .order("requested_at", { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (branch !== "all") query = query.eq("branch", branch);

    const { data, error } = await query;
    if (error) {
      loadFailed = true;
      break;
    }
    const batch = (data ?? []) as unknown as WithdrawalRow[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  const truncated = rows.length >= PAGE_SIZE * MAX_PAGES;

  let totalCost = 0;
  let noCost = 0;
  const byBranch = new Map<string, { count: number; cost: number }>();
  const byDept = new Map<string, { count: number; cost: number }>();
  const byItem = new Map<string, { name: string; unit: string; qty: number; cost: number }>();

  const add = (map: Map<string, { count: number; cost: number }>, key: string, cost: number | null) => {
    const cur = map.get(key) ?? { count: 0, cost: 0 };
    cur.count += 1;
    cur.cost += cost ?? 0;
    map.set(key, cur);
  };

  for (const r of rows) {
    const raw = r.total_cost === null || r.total_cost === undefined ? null : Number(r.total_cost);
    const cost = raw === null || Number.isNaN(raw) ? null : raw;
    if (cost === null) noCost += 1;
    else totalCost += cost;

    add(byBranch, branchLabel(r.branch ?? ""), cost);
    add(byDept, (r.department ?? "").trim() || "No department", cost);

    const item = one(r.items);
    const cur = byItem.get(r.item_id) ?? { name: item?.name ?? "Unknown item", unit: item?.unit ?? "", qty: 0, cost: 0 };
    cur.qty += Number(r.quantity) || 0;
    cur.cost += cost ?? 0;
    byItem.set(r.item_id, cur);
  }

  const toLines = (map: Map<string, { count: number; cost: number }>): Line[] =>
    Array.from(map.entries())
      .map(([label, v]) => ({ label, count: v.count, cost: v.cost }))
      .sort((a, b) => b.cost - a.cost);

  const itemList = Array.from(byItem.values());
  const topCost = [...itemList].sort((a, b) => b.cost - a.cost).slice(0, 10);
  const topQty = [...itemList].sort((a, b) => b.qty - a.qty).slice(0, 10);

  // Active items with no cost yet.
  let noCostQuery = service
    .from("items")
    .select("name, branch, unit")
    .eq("is_active", true)
    .or("unit_price.is.null,unit_price.lte.0")
    .order("name")
    .limit(500);
  if (branch !== "all") noCostQuery = noCostQuery.eq("branch", branch);
  const { data: noCostData } = await noCostQuery;
  const noCostItems = (noCostData ?? []) as { name: string; branch: string; unit: string }[];

  const selectClass = "block h-10 rounded-md border border-input bg-background px-3 text-sm";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Spending</h1>
        <p className="mt-1 text-sm text-slate-500">
          What staff withdrew in a month, valued at each item&apos;s average cost at the time of the withdrawal.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="month" className="text-xs text-muted-foreground">
            Month
          </label>
          <select id="month" name="month" defaultValue={month} className={selectClass}>
            {monthOptions.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="branch" className="text-xs text-muted-foreground">
            Branch
          </label>
          <select id="branch" name="branch" defaultValue={branch} className={selectClass}>
            <option value="all">All branches</option>
            <option value="office">Office</option>
            <option value="factory">Factory</option>
          </select>
        </div>
        <button
          type="submit"
          className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Show
        </button>
      </form>

      {loadFailed ? (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Could not load the withdrawals. Please refresh the page.
        </p>
      ) : null}
      {truncated ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          This month has more than {PAGE_SIZE * MAX_PAGES} withdrawals, so the numbers are incomplete. Narrow it down by
          branch.
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total cost</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold tabular-nums">{money(totalCost)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Withdrawals</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">{rows.length}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">No cost recorded</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold text-amber-600">{noCost}</CardContent>
        </Card>
      </div>
      {noCost > 0 ? (
        <p className="-mt-3 text-xs text-muted-foreground">
          Withdrawals with no cost recorded (made before costs were tracked, or of items with no cost set) are counted
          above but not included in the cost totals.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <SummaryTable title="By branch" firstHead="Branch" rows={toLines(byBranch)} />
        <SummaryTable title="By department" firstHead="Department" rows={toLines(byDept)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Highest cost items</CardTitle>
          </CardHeader>
          <CardContent>
            {topCost.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No withdrawals in this selection.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topCost.map((i) => (
                    <TableRow key={`${i.name}-${i.unit}-c`}>
                      <TableCell className="font-medium">{i.name}</TableCell>
                      <TableCell className="text-right">
                        {i.qty} {i.unit}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{money(i.cost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Most withdrawn items</CardTitle>
          </CardHeader>
          <CardContent>
            {topQty.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No withdrawals in this selection.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topQty.map((i) => (
                    <TableRow key={`${i.name}-${i.unit}-q`}>
                      <TableCell className="font-medium">{i.name}</TableCell>
                      <TableCell className="text-right">
                        {i.qty} {i.unit}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{money(i.cost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Items with no cost set ({noCostItems.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {noCostItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">Every active item has a cost.</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Set a cost with <b>Edit</b> on the dashboard, or enter the price the next time you restock.
              </p>
              <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                {noCostItems.slice(0, 30).map((i, idx) => (
                  <li key={`${i.name}-${i.branch}-${idx}`} className="flex justify-between gap-2 border-b py-1">
                    <span className="truncate">{i.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{branchLabel(i.branch)}</span>
                  </li>
                ))}
              </ul>
              {noCostItems.length > 30 ? (
                <p className="text-xs text-muted-foreground">Showing the first 30 of {noCostItems.length}.</p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}