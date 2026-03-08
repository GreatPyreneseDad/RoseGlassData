"use client";

import { useEffect, useState } from "react";

interface RecentTopic {
  topic: string;
  latest_date: string;
  count: number;
}

export function TopicBrowser({ onSelect }: { onSelect: (topic: string) => void }) {
  const [topics, setTopics] = useState<RecentTopic[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/topics")
      .then((r) => r.json())
      .then((data) => setTopics(data.topics || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading || topics.length === 0) return null;

  return (
    <div>
      <p className="text-xs text-slate-500 mb-2">Pre-loaded topics — click to analyze instantly</p>
      <div className="flex flex-wrap gap-2">
        {topics.map((t) => (
          <button
            key={t.topic}
            onClick={() => onSelect(t.topic)}
            className="group flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-teal-600 rounded-lg text-xs transition-all"
          >
            <span className="text-white font-medium">{t.topic}</span>
            <span className="text-slate-600 group-hover:text-slate-400">
              {t.latest_date.slice(5)}
            </span>
            {t.count > 1 && (
              <span className="text-teal-600 text-[10px]">{t.count}d</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
