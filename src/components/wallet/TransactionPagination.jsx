import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

// Windows the visible page numbers around the current page so the control
// stays compact even with hundreds/thousands of transactions (many pages).
function getVisiblePages(page, totalPages) {
  const windowSize = 2;
  const start = Math.max(1, page - windowSize);
  const end = Math.min(totalPages, page + windowSize);
  const pages = [];
  for (let p = start; p <= end; p++) pages.push(p);
  return pages;
}

export default function TransactionPagination({ page, totalPages, onPageChange }) {
  const pages = getVisiblePages(page, totalPages);

  return (
    <div className="flex items-center justify-center gap-1.5 mt-4">
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className="flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-semibold text-white/50 hover:text-white disabled:opacity-30 disabled:pointer-events-none"
      >
        <ChevronLeft size={14} /> Previous
      </button>

      {pages[0] > 1 && <span className="text-white/20 text-xs px-1">…</span>}

      {pages.map((p) => (
        <button
          key={p}
          onClick={() => onPageChange(p)}
          className={`h-8 min-w-8 px-2 rounded-lg text-xs font-semibold ${
            p === page ? "bg-[#C9A84C] text-black" : "text-white/50 hover:text-white hover:bg-white/5"
          }`}
        >
          {p}
        </button>
      ))}

      {pages[pages.length - 1] < totalPages && <span className="text-white/20 text-xs px-1">…</span>}

      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        className="flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-semibold text-white/50 hover:text-white disabled:opacity-30 disabled:pointer-events-none"
      >
        Next <ChevronRight size={14} />
      </button>
    </div>
  );
}