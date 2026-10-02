// eslint-disable @typescript-eslint/no-explicit-any react-hooks/set-state-in-effect
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, Input, Label } from "@/components/ui";

export default function SettingsPage() {
  const supabase = createClient();
  const [settings, setSettings] = useState<any>(null);
  const [zones, setZones] = useState<any[]>([]);
  const [pincode, setPincode] = useState("");
  const [areaEn, setAreaEn] = useState("");
  const [areaKn, setAreaKn] = useState("");
  const [fee, setFee] = useState("");
  const [eta, setEta] = useState("");
  const [activeZone, setActiveZone] = useState(true);

  const load = async () => {
    const { data: s } = await supabase.from("store_settings").select("*").limit(1).maybeSingle();
    const { data: z } = await supabase.from("delivery_zones").select("*").order("pincode");
    setSettings(s);
    setZones(z ?? []);
  };

  useEffect(() => {
    load();
  }, []);

  const saveSettings = async () => {
    if (!settings) return;
    await supabase.from("store_settings").update({
      is_open: settings.is_open,
      open_time: settings.open_time,
      close_time: settings.close_time,
      min_order_value_paise: Math.round((parseFloat(settings.min_order_rupees || "0")) * 100),
      delivery_fee_paise: Math.round((parseFloat(settings.delivery_fee_rupees || "0")) * 100),
      free_delivery_above_paise: settings.free_delivery_above_rupees ? Math.round((parseFloat(settings.free_delivery_above_rupees)) * 100) : null,
      low_stock_threshold: parseInt(settings.low_stock_threshold) || 5,
      timezone: settings.timezone || "Asia/Kolkata",
    }).eq("id", settings.id);
    load();
  };

  const addZone = async () => {
    const { data: store } = await supabase.from("stores").select("id").eq("is_active", true).limit(1).maybeSingle();
    if (!store) return;
    await supabase.from("delivery_zones").insert({
      store_id: store.id,
      pincode: pincode.trim(),
      area_name_en: areaEn.trim() || null,
      area_name_kn: areaKn.trim() || null,
      delivery_fee_paise: fee ? Math.round(parseFloat(fee) * 100) : 0,
      eta_minutes: eta ? parseInt(eta) : null,
      is_active: activeZone,
    });
    setPincode(""); setAreaEn(""); setAreaKn(""); setFee(""); setEta(""); setActiveZone(true);
    load();
  };

  const toggleZone = async (z: any) => {
    await supabase.from("delivery_zones").update({ is_active: !z.is_active }).eq("id", z.id);
    load();
  };

  const delZone = async (z: any) => {
    await supabase.from("delivery_zones").delete().eq("id", z.id);
    load();
  };

  return (
    <div className="p-4 space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>
      {settings && (
        <div className="grid gap-4 max-w-xl">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={settings.is_open} onChange={(e) => setSettings({ ...settings, is_open: e.target.checked })} />
            <span>Store is open</span>
          </label>
          {settings.is_open === false && (
            <p className="text-sm text-red-600">Warning: store is closed — orders cannot be placed</p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label>Open time</Label>
              <Input type="time" value={settings.open_time ?? ''} onChange={(e) => setSettings({ ...settings, open_time: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label>Close time</Label>
              <Input type="time" value={settings.close_time ?? ''} onChange={(e) => setSettings({ ...settings, close_time: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-1">
            <Label>Timezone</Label>
            <Input value={settings.timezone ?? 'Asia/Kolkata'} onChange={(e) => setSettings({ ...settings, timezone: e.target.value })} />
          </div>
          <div className="grid gap-1">
            <Label>Minimum order (₹)</Label>
            <Input value={settings.min_order_rupees ?? ((settings.min_order_value_paise||0)/100).toFixed(2)} onChange={(e) => setSettings({ ...settings, min_order_rupees: e.target.value })} />
          </div>
          <div className="grid gap-1">
            <Label>Delivery fee (₹)</Label>
            <Input value={settings.delivery_fee_rupees ?? ((settings.delivery_fee_paise||0)/100).toFixed(2)} onChange={(e) => setSettings({ ...settings, delivery_fee_rupees: e.target.value })} />
          </div>
          <div className="grid gap-1">
            <Label>Free delivery above (₹, blank for none)</Label>
            <Input value={settings.free_delivery_above_rupees ?? (settings.free_delivery_above_paise ? (settings.free_delivery_above_paise/100).toFixed(2) : '')} onChange={(e) => setSettings({ ...settings, free_delivery_above_rupees: e.target.value })} />
          </div>
          <div className="grid gap-1">
            <Label>Low stock threshold</Label>
            <Input type="number" value={settings.low_stock_threshold ?? 5} onChange={(e) => setSettings({ ...settings, low_stock_threshold: e.target.value })} />
          </div>
          <Button onClick={saveSettings}>Save settings</Button>
        </div>
      )}
      <div className="space-y-4">
        <h2 className="font-medium">Delivery zones</h2>
        <div className="grid gap-2 max-w-3xl grid-cols-6 items-end">
          <div className="col-span-1 grid gap-1">
            <Label>Pincode</Label>
            <Input value={pincode} onChange={(e) => setPincode(e.target.value)} />
          </div>
          <div className="col-span-2 grid gap-1">
            <Label>Area EN</Label>
            <Input value={areaEn} onChange={(e) => setAreaEn(e.target.value)} />
          </div>
          <div className="col-span-2 grid gap-1">
            <Label>Area KN</Label>
            <Input value={areaKn} onChange={(e) => setAreaKn(e.target.value)} />
          </div>
          <div className="col-span-1 grid gap-1">
            <Label>Fee (₹)</Label>
            <Input value={fee} onChange={(e) => setFee(e.target.value)} />
          </div>
          <div className="col-span-1 grid gap-1">
            <Label>ETA (min)</Label>
            <Input value={eta} onChange={(e) => setEta(e.target.value)} />
          </div>
          <label className="col-span-2 flex items-center gap-2">
            <input type="checkbox" checked={activeZone} onChange={(e) => setActiveZone(e.target.checked)} />
            <span>Active</span>
          </label>
          <Button onClick={addZone}>Add zone</Button>
        </div>
        <div className="border rounded">
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50">
              <tr>
                <th className="p-2 text-left">Pincode</th>
                <th className="p-2 text-left">Area EN</th>
                <th className="p-2 text-left">Area KN</th>
                <th className="p-2 text-left">Fee (₹)</th>
                <th className="p-2 text-left">ETA</th>
                <th className="p-2 text-left">Active</th>
                <th className="p-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {zones.map((z) => (
                <tr key={z.id} className="border-b">
                  <td className="p-2">{z.pincode}</td>
                  <td className="p-2">{z.area_name_en}</td>
                  <td className="p-2">{z.area_name_kn}</td>
                  <td className="p-2">{(z.delivery_fee_paise/100).toFixed(2)}</td>
                  <td className="p-2">{z.eta_minutes ?? ''}</td>
                  <td className="p-2">{z.is_active ? 'Yes' : 'No'}</td>
                  <td className="p-2 text-right flex justify-end gap-1">
                    <Button variant="outline" onClick={() => toggleZone(z)}>{z.is_active ? 'Deactivate' : 'Activate'}</Button>
                    <Button variant="destructive" onClick={() => delZone(z)}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}