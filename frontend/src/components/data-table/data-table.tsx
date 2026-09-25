"use client";

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
  type Table as TanTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown, Columns3, Loader2, Search, X } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/common/states";
import { DataTablePagination } from "@/components/data-table/pagination";
import { cn } from "@/lib/utils";
import type { PageMeta } from "@/types/api";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    className?: string;
    headerClassName?: string;
    /** Label used in the column visibility menu. */
    label?: string;
  }
}

export interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  /** Server pagination meta; omit for client-side pagination. */
  meta?: PageMeta;
  loading?: boolean;
  fetching?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  onSortChange?: (sortBy: string | undefined, sortOrder: "asc" | "desc") => void;
  getRowId?: (row: T) => string;
  enableSelection?: boolean;
  bulkActions?: (selected: T[], clear: () => void) => React.ReactNode;
  search?: { value: string; onChange: (v: string) => void; placeholder?: string };
  filters?: React.ReactNode;
  actions?: React.ReactNode;
  columnToggle?: boolean;
  initialColumnVisibility?: VisibilityState;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  empty?: { icon?: React.ComponentType<{ className?: string }>; title: string; description?: React.ReactNode; action?: React.ReactNode };
  className?: string;
  /** Max height for the scroll container (enables sticky header scrolling). */
  maxHeight?: string;
  toolbarExtra?: (table: TanTable<T>) => React.ReactNode;
  pageSizeOptions?: number[];
  dense?: boolean;
  bordered?: boolean;
}

export function DataTable<T>({
  columns,
  data,
  meta,
  loading,
  fetching,
  error,
  onRetry,
  onPageChange,
  onPageSizeChange,
  sortBy,
  sortOrder,
  onSortChange,
  getRowId,
  enableSelection,
  bulkActions,
  search,
  filters,
  actions,
  columnToggle = true,
  initialColumnVisibility,
  onRowClick,
  rowClassName,
  empty,
  className,
  maxHeight = "max(22rem, calc(100dvh - 16rem))",
  toolbarExtra,
  pageSizeOptions,
  dense = true,
  bordered = true,
}: DataTableProps<T>) {
  const serverMode = !!meta;
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(initialColumnVisibility ?? {});
  const [clientSorting, setClientSorting] = React.useState<SortingState>([]);

  const sorting: SortingState = serverMode ? (sortBy ? [{ id: sortBy, desc: sortOrder !== "asc" }] : []) : clientSorting;

  const selectionColumn = React.useMemo<ColumnDef<T, unknown>>(
    () => ({
      id: "__select",
      enableSorting: false,
      enableHiding: false,
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected() ? true : table.getIsSomePageRowsSelected() ? "indeterminate" : false}
          onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
          aria-label="Select all rows on this page"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(!!v)}
          onClick={(e) => e.stopPropagation()}
          aria-label="Select row"
        />
      ),
      meta: { className: "w-9", headerClassName: "w-9" },
    }),
    [],
  );

  const allColumns = React.useMemo(() => (enableSelection ? [selectionColumn, ...columns] : columns), [enableSelection, selectionColumn, columns]);

  const table = useReactTable<T>({
    data,
    columns: allColumns,
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
    state: { rowSelection, columnVisibility, sorting },
    enableRowSelection: !!enableSelection,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    manualPagination: serverMode,
    manualSorting: serverMode,
    pageCount: meta?.totalPages,
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      if (serverMode) {
        const s = next[0];
        onSortChange?.(s?.id, s ? (s.desc ? "desc" : "asc") : "desc");
      } else {
        setClientSorting(next);
      }
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: serverMode ? undefined : getSortedRowModel(),
    getPaginationRowModel: serverMode ? undefined : getPaginationRowModel(),
    initialState: serverMode ? undefined : { pagination: { pageSize: 25, pageIndex: 0 } },
    autoResetPageIndex: false,
  });

  // Clear selection when the page of data changes identity in server mode.
  const pageKey = serverMode ? `${meta?.page}-${meta?.pageSize}` : "";
  React.useEffect(() => {
    if (serverMode) setRowSelection({});
  }, [pageKey, serverMode]);

  const selectedRows = table.getSelectedRowModel().rows.map((r) => r.original);
  const clearSelection = () => setRowSelection({});
  const hideableColumns = table.getAllLeafColumns().filter((c) => c.getCanHide() && c.id !== "__select");
  const hasToolbar = !!(search || filters || actions || (columnToggle && hideableColumns.length > 1) || toolbarExtra);

  const rows = table.getRowModel().rows;

  return (
    <div className={cn("flex min-w-0 flex-col", bordered && "overflow-hidden rounded-lg border bg-card shadow-xs", className)}>
      {hasToolbar && (
        <div className="flex flex-col gap-2 border-b p-2.5 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {search && (
              <div className="relative w-full sm:w-64">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search.value}
                  onChange={(e) => search.onChange(e.target.value)}
                  placeholder={search.placeholder ?? "Search…"}
                  className="h-8 pl-8 pr-7 text-xs"
                  aria-label={search.placeholder ?? "Search"}
                />
                {search.value && (
                  <button
                    type="button"
                    onClick={() => search.onChange("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                    aria-label="Clear search"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            )}
            {filters}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(fetching || (loading && data.length > 0)) && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading" />}
            {toolbarExtra?.(table)}
            {actions}
            {columnToggle && hideableColumns.length > 1 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" aria-label="Show or hide columns">
                    <Columns3 /> <span className="hidden sm:inline">Columns</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
                  <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {hideableColumns.map((c) => (
                    <DropdownMenuCheckboxItem
                      key={c.id}
                      checked={c.getIsVisible()}
                      onCheckedChange={(v) => c.toggleVisibility(!!v)}
                      onSelect={(e) => e.preventDefault()}
                    >
                      {c.columnDef.meta?.label ?? (typeof c.columnDef.header === "string" ? c.columnDef.header : c.id)}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      )}

      {enableSelection && selectedRows.length > 0 && bulkActions && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-primary/5 px-3 py-2 text-sm">
          <span className="font-medium">{selectedRows.length} selected</span>
          <Button variant="ghost" size="xs" onClick={clearSelection}>
            Clear
          </Button>
          <div className="ml-auto flex flex-wrap items-center gap-2">{bulkActions(selectedRows, clearSelection)}</div>
        </div>
      )}

      {error && !loading && data.length === 0 ? (
        <ErrorState error={error} onRetry={onRetry} compact />
      ) : loading && data.length === 0 ? (
        <TableSkeleton rows={8} cols={Math.min(allColumns.length, 6)} />
      ) : rows.length === 0 ? (
        <EmptyState compact icon={empty?.icon} title={empty?.title ?? "No results"} description={empty?.description} action={empty?.action} className="py-10" />
      ) : (
        <Table containerClassName="scrollbar-thin" containerStyle={maxHeight ? { maxHeight } : undefined} className={cn(fetching && "opacity-80 transition-opacity")}>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {hg.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const dir = header.column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      className={cn(header.column.columnDef.meta?.headerClassName)}
                      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          className="-ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 uppercase hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {dir === "asc" ? <ArrowUp className="size-3" /> : dir === "desc" ? <ArrowDown className="size-3" /> : <ChevronsUpDown className="size-3 opacity-40" />}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() ? "selected" : undefined}
                className={cn(onRowClick && "cursor-pointer", rowClassName?.(row.original))}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === "Enter" && e.target === e.currentTarget) onRowClick(row.original);
                      }
                    : undefined
                }
                tabIndex={onRowClick ? 0 : undefined}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className={cn(dense ? "py-1.5" : "py-2.5", cell.column.columnDef.meta?.className)}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {serverMode && meta && meta.total > 0 ? (
        <DataTablePagination
          page={meta.page}
          pageSize={meta.pageSize}
          total={meta.total}
          totalPages={meta.totalPages}
          onPageChange={(p) => onPageChange?.(p)}
          onPageSizeChange={onPageSizeChange}
          pageSizeOptions={pageSizeOptions}
        />
      ) : !serverMode && data.length > table.getState().pagination.pageSize ? (
        <DataTablePagination
          page={table.getState().pagination.pageIndex + 1}
          pageSize={table.getState().pagination.pageSize}
          total={data.length}
          totalPages={table.getPageCount()}
          onPageChange={(p) => table.setPageIndex(p - 1)}
          onPageSizeChange={(s) => table.setPageSize(s)}
          pageSizeOptions={pageSizeOptions}
        />
      ) : null}

    </div>
  );
}
