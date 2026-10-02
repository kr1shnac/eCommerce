// eslint-disable @typescript-eslint/no-explicit-any react-hooks/set-state-in-effect
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, Input, Label } from "@/components/ui";

export default function ProductsPage() {
  const supabase = createClient();
  const [items, setItems] = useState<any[]>([]);
  const [cats, setCats] = useState<any[]>([]);
  const [threshold, setThreshold] = useState<number>(5);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [catId, setCatId] = useState<string | null>(null);
  const [lowOnly, setLowOnly] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameEn, setNameEn] = useState("");
  const [nameKn, setNameKn] = useState("");
  const [priceR, setPriceR] = useState("");
  const [mrpR, setMrpR] = useState("");
  const [unit, setUnit] = useState("");
  const [stock, setStock] = useState("0");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [image, setImage] = useState<File | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: prods }, { data: c }, { data: settings }] = await Promise.all([
      supabase.from("products").select("*").order("sort_order", { ascending: true }),
      supabase.from("categories").select("*").order("sort_order"),
      supabase.from("store_settings").select("low_stock_threshold").limit(1).maybeSingle(),
    ]);
    setItems(prods ?? []);
    setCats(c ?? []);
    setThreshold(settings?.low_stock_threshold ?? 5);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = items.filter((p) => {
    if (catId && p.category_id !== catId) return false;
    const name = `${p.name_en} ${p.name_kn}`.toLowerCase();
    if (search && !name.includes(search.toLowerCase())) return false;
    if (lowOnly && p.stock_qty >= threshold) return false;
    return true;
  });

  const quickStock = async (id: string, qty: number) => {
    await supabase.from("products").update({ stock_qty: Math.max(0, qty) }).eq("id", id);
    load();
  };

  const resetForm = () => {
    setEditingId(null);
    setNameEn(""); setNameKn(""); setPriceR(""); setMrpR(""); setUnit(""); setStock("0"); setCategoryId(null); setIsActive(true); setImage(null);
  };

  const compress = async (file: File): Promise<File> => {
    const img = new Image();
    const reader = new FileReader();
    return new Promise((resolve) => {
      reader.onload = () => {
        img.onload = () => {
          const canvas = document.createElement("canvas");
          let w = img.width, h = img.height;
          const max = 1080;
          if (w > max || h > max) {
            const r = Math.min(max/w, max/h);
            w = Math.round(w*r); h = Math.round(h*r);
          }
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx?.drawImage(img, 0, 0, w, h);
          canvas.toBlob((b) => {
            if (b) resolve(new File([b], file.name.replace(/\.[^.]+$/, ".webp"), { type: "image/webp" }));
            else resolve(file);
          }, "image/webp", 0.8);
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    });
  };

  const save = async () => {
    let imageUrl: string | null = null;
    if (image) {
      const c = await compress(image);
      const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.webp`;
      const { data, error } = await supabase.storage.from("product-images").upload(path, c);
      if (!error && data) {
        const { data: pub } = supabase.storage.from("product-images").getPublicUrl(data.path);
        imageUrl = pub.publicUrl;
      }
    }
    const priceP = Math.round(parseFloat(priceR || "0") * 100);
    const mrpP = mrpR ? Math.round(parseFloat(mrpR) * 100) : null;
    const payload: any = {
      name_en: nameEn.trim(),
      name_kn: nameKn.trim(),
      price_paise: priceP,
      mrp_paise: mrpP,
      unit: unit.trim(),
      stock_qty: Math.max(0, parseInt(stock) || 0),
      category_id: categoryId,
      is_active: isActive,
    };
    if (imageUrl) payload.image_url = imageUrl;
    if (editingId) {
      await supabase.from("products").update(payload).eq("id", editingId);
    } else {
      const { data: store } = await supabase.from("stores").select("id").eq("is_active", true).limit(1).maybeSingle();
      if (store?.id) await supabase.from("products").insert({ ...payload, store_id: store.id, sort_order: 0 });
    }
    resetForm();
    load();
  };

  const edit = (p: any) => {
    setEditingId(p.id);
    setNameEn(p.name_en); setNameKn(p.name_kn); setPriceR((p.price_paise/100).toFixed(2)); setMrpR(p.mrp_paise!=null ? (p.mrp_paise/100).toFixed(2): ""); setUnit(p.unit); setStock(String(p.stock_qty)); setCategoryId(p.category_id); setIsActive(p.is_active);
  };

  return (
    <div className="p-4 space-y-6">
      <h1 className="text-xl font-semibold">Products</h1>
      <div className="grid gap-4 max-w-xl">
        <div className="grid gap-2"><Label>Name (English)</Label><Input value={nameEn} onChange={(e)=>setNameEn(e.target.value)} /></div>
        <div className="grid gap-2"><Label>Name (Kannada)</Label><Input value={nameKn} onChange={(e)=>setNameKn(e.target.value)} /></div>
        <div className="grid gap-2"><Label>Price (₹)</Label><Input value={priceR} onChange={(e)=>setPriceR(e.target.value)} /></div>
        <div className="grid gap-2"><Label>MRP (₹)</Label><Input value={mrpR} onChange={(e)=>setMrpR(e.target.value)} /></div>
        <div className="grid gap-2"><Label>Unit</Label><Input value={unit} onChange={(e)=>setUnit(e.target.value)} /></div>
        <div className="grid gap-2"><Label>Stock</Label><Input type="number" value={stock} onChange={(e)=>setStock(e.target.value)} /></div>
        <div className="grid gap-2"><Label>Category</Label>
          <select value={categoryId ?? ""} onChange={(e)=>setCategoryId(e.target.value||null)} className="border h-9 px-2 rounded">
            <option value="">Select</option>{cats.map(c=><option key={c.id} value={c.id}>{c.name_en}</option>)}
          </select>
        </div>
        <div className="grid gap-2"><Label>Image</Label><Input type="file" accept="image/*" onChange={(e)=>setImage(e.target.files?.[0]||null)} /></div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={isActive} onChange={(e)=>setIsActive(e.target.checked)} /><span>Active</span></label>
        <div className="flex gap-2"><Button onClick={save}>{editingId?"Update":"Create"}</Button>{editingId&&<Button variant="outline" onClick={resetForm}>Cancel</Button>}</div>
      </div>
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2 items-end">
          <div className="grid gap-1"><Label>Search</Label><Input value={search} onChange={(e)=>setSearch(e.target.value)} /></div>
          <div className="grid gap-1"><Label>Category</Label>
            <select value={catId ?? ''} onChange={(e)=>setCatId(e.target.value||null)} className="border h-9 px-2 rounded">
              <option value="">All</option>{cats.map(c=><option key={c.id} value={c.id}>{c.name_en}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={lowOnly} onChange={(e)=>setLowOnly(e.target.checked)} /><span>Low stock (&lt; {threshold})</span></label>
        </div>
        <div className="border rounded overflow-x-auto">
          <table className="w-full text-sm min-w-[1000px]">
            <thead className="border-b bg-gray-50"><tr><th className="p-2 text-left">Name EN</th><th className="p-2 text-left">Name KN</th><th className="p-2 text-left">Cat</th><th className="p-2 text-left">Price (₹)</th><th className="p-2 text-left">MRP (₹)</th><th className="p-2 text-left">Unit</th><th className="p-2 text-left">Stock</th><th className="p-2 text-left">Active</th><th className="p-2 text-right">Actions</th></tr></thead>
            <tbody>{filtered.map((p)=>(
              <tr key={p.id} className="border-b">
                <td className="p-2">{p.name_en}</td><td className="p-2">{p.name_kn}</td><td className="p-2">{cats.find(c=>c.id===p.category_id)?.name_en??''}</td>
                <td className="p-2">{(p.price_paise/100).toFixed(2)}</td><td className="p-2">{p.mrp_paise!=null?(p.mrp_paise/100).toFixed(2):''}</td>
                <td className="p-2">{p.unit}</td><td className="p-2">{p.stock_qty}</td><td className="p-2">{p.is_active?'Yes':'No'}</td>
                <td className="p-2 text-right flex justify-end gap-1">
                  <Button variant="outline" onClick={()=>quickStock(p.id,p.stock_qty-1)}>-</Button>
                  <Button variant="outline" onClick={()=>quickStock(p.id,p.stock_qty+1)}>+</Button>
                  <Button variant="outline" onClick={()=>edit(p)}>Edit</Button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}