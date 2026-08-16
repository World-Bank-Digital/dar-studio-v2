import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { model } from "@/lib/damm/model";

export const Route = createFileRoute("/glossary")({ component: Glossary });

function Glossary() {
  return (
    <AppShell>
      <h1 className="font-display text-3xl font-semibold">Glossary</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">Definitions live in the versioned model file, not in the interface copy.</p>
      <div className="mt-6 grid gap-3">
        {model.glossary.map((g) => (
          <Card key={g.term}>
            <p className="font-mono text-xs text-sage">{g.term}</p>
            <h2 className="font-display text-xl">{g.name}</h2>
            <p className="text-xs text-subtle">{g.short}</p>
            <p className="mt-2 text-sm text-muted">{g.text}</p>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
