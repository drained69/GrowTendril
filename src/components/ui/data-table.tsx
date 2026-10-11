"use client";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Search } from "lucide-react";
import { Table } from "@/components/ui/table";
import { cn } from "@/components/ui/cn";

export interface Column {
  key: string;
  label: string;
  align?: "left" | "right";
  sortable?: boolean;
  className?: string;
}
export interface Row {
  id: string;
  href?: string;
  /** Rendered cells (may be server-rendered elements) and the raw values used for sorting/searching. */
  cells: Record<string, ReactNode>;
  sort?: Record<string, number | string | null>;
  search?: string;
}

/** Sortable, filterable table. Rows are rendered on the server and passed in; sorting is client-side. */
export function DataTable({ columns, rows, defaultSort, searchable, empty, pageSize = 50 }: { columns: Column[]; rows: Row[]; defaultSort?: { key: string; dir: "asc" | "desc" }; searchable?: boolean; empty?: ReactNode; pageSize?: number }) {
  const [sort, setSort] = useState(defaultSort);
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(pageSize);
  const shown = useMemo(() => {
    const filtered = q ? rows.filter((r) => (r.search ?? "").toLowerCase().includes(q.toLowerCase())) : rows;
    if (!sort) return filtered;
    return [...filtered].sort((a, b) => {
      const av = a.sort?.[sort.key] ?? null;
      const bv = b.sort?.[sort.key] ?? null;
      if (av === bv) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      const c = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sort.dir === "asc" ? c : -c;
    });
  }, [rows, sort, q]);
  return (
    <div>
      {searchable && (
        <div className="flex items-center gap-2 border-b border-line px-4 py-2">
          <Search className="size-3.5 text-ink-4" />
          <input aria-label="Filter table rows" value={q} onChange={(e) => { setQ(e.target.value); setLimit(pageSize); }} placeholder="Filter…" className="h-7 min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-4" />
          <span role="status" className="num text-[11px] text-ink-4">{shown.length}</span>
        </div>
      )}
      {shown.length === 0 ? (
        <div className="p-6">{q ? <div className="text-center text-[12.5px] text-ink-3">No rows match this filter. <button type="button" onClick={() => setQ("")} className="text-s1 hover:underline">Clear filter</button></div> : empty ?? <div className="text-center text-[12.5px] text-ink-3">Nothing here yet.</div>}</div>
      ) : (
        <Table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" aria-sort={c.sortable ? sort?.key === c.key ? sort.dir === "asc" ? "ascending" : "descending" : "none" : undefined} className={cn(c.align === "right" && "text-right", c.className)}>
                  {c.sortable ? (
                    <button
                      onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === "asc" ? "desc" : "asc" } : { key: c.key, dir: "desc" }))}
                      className={cn("inline-flex items-center gap-1 hover:text-ink [&_svg]:size-3", sort?.key === c.key && "text-ink")}
                    >
                      {c.label}
                      {sort?.key === c.key ? sort.dir === "asc" ? <ArrowUp /> : <ArrowDown /> : <ChevronsUpDown className="opacity-40" />}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, limit).map((r) => (
              <tr key={r.id}>
                {columns.map((c, i) => (
                  <td key={c.key} className={cn(c.align === "right" && "text-right", c.className)}>
                    {r.href && i === 0 ? (
                      <Link href={r.href} className="block font-medium text-ink hover:underline">
                        {r.cells[c.key]}
                      </Link>
                    ) : (
                      r.cells[c.key]
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {shown.length > limit && (
        <div className="border-t border-line px-4 py-2 text-center">
          <button onClick={() => setLimit((l) => l + pageSize)} className="text-[12px] text-s1 hover:underline">
            Show {Math.min(pageSize, shown.length - limit)} more of {shown.length - limit}
          </button>
        </div>
      )}
    </div>
  );
}
