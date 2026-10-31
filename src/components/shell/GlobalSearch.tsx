'use client';

import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export function GlobalSearch() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  return (
    <form
      role="search"
      className="hidden items-center border border-border bg-card px-3 focus-within:ring-2 focus-within:ring-ring md:flex"
      onSubmit={(event) => {
        event.preventDefault();
        const value = query.trim();
        if (value) router.push(`/app/search?q=${encodeURIComponent(value)}`);
      }}
    >
      <Search className="size-4 text-operational-muted" aria-hidden="true" />
      <label htmlFor="global-search" className="sr-only">
        Search cases and actions
      </label>
      <input
        ref={input}
        id="global-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search case or action"
        maxLength={80}
        className="h-9 w-40 bg-transparent px-3 text-sm outline-none xl:w-52"
      />
      <kbd className="border border-border px-1.5 py-0.5 text-xs text-operational-muted">⌘K</kbd>
    </form>
  );
}
