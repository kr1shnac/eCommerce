"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, Input, Label } from "@/components/ui";

type CategoryRow = {
  id: string;
  name_en: string;
  name_kn: string;
  sort_order: number;
  is_active: boolean;
};

/** Read the whole list. Kept outside the component so it is not a reactive dep. */
async function fetchCategories(supabase: ReturnType<typeof createClient>): Promise<CategoryRow[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("id, name_en, name_kn, sort_order, is_active")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as CategoryRow[];
}

export default function CategoriesPage() {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [nameEn, setNameEn] = useState("");
  const [nameKn, setNameKn] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [isActive, setIsActive] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);

  // The awaited work happens before any setState, so this is not a
  // synchronous setState inside an effect.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const rows = await fetchCategories(supabase);
        if (active) setItems(rows);
      } catch (error) {
        console.warn("[categories] could not load", error);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [supabase]);

  const reload = async () => {
    setItems(await fetchCategories(supabase));
  };

  const reset = () => {
    setEditingId(null);
    setNameEn("");
    setNameKn("");
    setSortOrder("0");
    setIsActive(true);
  };

  const save = async () => {
    const payload = {
      name_en: nameEn.trim(),
      name_kn: nameKn.trim(),
      sort_order: Number.parseInt(sortOrder, 10) || 0,
      is_active: isActive,
    };
    if (!payload.name_en || !payload.name_kn) return;
    if (editingId) {
      await supabase.from("categories").update(payload).eq("id", editingId);
    } else {
      const { data: store } = await supabase
        .from("stores")
        .select("id")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      if (store?.id) await supabase.from("categories").insert({ ...payload, store_id: store.id });
    }
    reset();
    await reload();
  };

  const edit = (c: CategoryRow) => {
    setEditingId(c.id);
    setNameEn(c.name_en);
    setNameKn(c.name_kn);
    setSortOrder(String(c.sort_order));
    setIsActive(c.is_active);
  };

  const toggleActive = async (c: CategoryRow) => {
    await supabase.from("categories").update({ is_active: !c.is_active }).eq("id", c.id);
    await reload();
  };

  const move = async (id: string, delta: number) => {
    const current = items.find((i) => i.id === id);
    if (!current) return;
    await supabase.from("categories").update({ sort_order: current.sort_order + delta }).eq("id", id);
    await reload();
  };

  return (
    <div className="p-4 space-y-6">
      <h1 className="text-xl font-semibold">Categories</h1>
      <div className="grid gap-4 max-w-xl">
        <div className="grid gap-2">
          <Label>Name (English)</Label>
          <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label>Name (Kannada)</Label>
          <Input value={nameKn} onChange={(e) => setNameKn(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label>Sort order</Label>
          <Input value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          <span>Active</span>
        </label>
        <div className="flex gap-2">
          <Button onClick={save}>{editingId ? "Update" : "Create"}</Button>
          {editingId && <Button variant="outline" onClick={reset}>Cancel</Button>}
        </div>
      </div>
      {loading ? (
        <p>Loading...</p>
      ) : (
        <div className="border rounded">
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50">
              <tr>
                <th className="p-2 text-left">Order</th>
                <th className="p-2 text-left">Name (EN)</th>
                <th className="p-2 text-left">Name (KN)</th>
                <th className="p-2 text-left">Active</th>
                <th className="p-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-b">
                  <td className="p-2">{c.sort_order}</td>
                  <td className="p-2">{c.name_en}</td>
                  <td className="p-2">{c.name_kn}</td>
                  <td className="p-2">{c.is_active ? "Yes" : "No"}</td>
                  <td className="p-2 text-right flex justify-end gap-1">
                    <Button variant="ghost" onClick={() => move(c.id, -1)}>-</Button>
                    <Button variant="ghost" onClick={() => move(c.id, 1)}>+</Button>
                    <Button variant="outline" onClick={() => toggleActive(c)}>
                      {c.is_active ? "Deactivate" : "Activate"}
                    </Button>
                    <Button variant="outline" onClick={() => edit(c)}>Edit</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
