import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { isSupabaseConfigured, supabase } from "./supabaseClient";
import "./styles.css";

const ageGroups = ["18-24", "25-34", "35-44", "45+"];
const styleSignals = ["minimal street", "soft tailored", "color pop", "romantic vintage"];
const categories = ["top", "bottom", "outerwear", "shoe", "accessory"];

function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [closet, setCloset] = useState([]);
  const [feed, setFeed] = useState([]);
  const [saves, setSaves] = useState([]);
  const [activeView, setActiveView] = useState("feed");
  const [status, setStatus] = useState("");
  const [authMode, setAuthMode] = useState("sign-in");
  const [authForm, setAuthForm] = useState({ email: "", password: "", displayName: "" });
  const [closetForm, setClosetForm] = useState({ name: "", category: "top", color: "#426941", tags: "" });
  const [closetPhoto, setClosetPhoto] = useState(null);
  const [outfitForm, setOutfitForm] = useState({ title: "", caption: "", visibility: "public", itemIds: [] });
  const [outfitPhoto, setOutfitPhoto] = useState(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) {
      setProfile(null);
      setCloset([]);
      setFeed([]);
      setSaves([]);
      return;
    }

    ensureProfile();
    loadAppData();
  }, [session?.user?.id]);

  const recommendation = useMemo(() => {
    const ownedCategories = new Set(closet.map((item) => item.category));
    const savedOutfits = feed.filter((outfit) => saves.includes(outfit.id));
    const savedWords = savedOutfits.flatMap((outfit) => `${outfit.title} ${outfit.caption || ""}`.toLowerCase().split(/\W+/));
    const preferenceWords = `${profile?.style_signal || ""} ${savedWords.join(" ")}`;

    return categories
      .map((category) => {
        const exact = closet.find((item) => item.category === category && item.tags?.some((tag) => preferenceWords.includes(tag.toLowerCase())));
        return exact || closet.find((item) => item.category === category);
      })
      .filter(Boolean)
      .filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index)
      .map((item) => ({
        ...item,
        reason: ownedCategories.has(item.category) ? "owned match" : "gap"
      }));
  }, [closet, feed, profile?.style_signal, saves]);

  async function ensureProfile() {
    const user = session.user;
    const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (error) {
      setStatus(error.message);
      return;
    }
    if (data) {
      setProfile(data);
      return;
    }
    const newProfile = {
      id: user.id,
      display_name: user.user_metadata?.display_name || authForm.displayName || user.email?.split("@")[0] || "New stylist",
      age_group: "25-34",
      style_signal: "minimal street"
    };
    const { data: created, error: createError } = await supabase.from("profiles").insert(newProfile).select().single();
    if (createError) setStatus(createError.message);
    setProfile(created || newProfile);
  }

  async function loadAppData() {
    const [closetResult, feedResult, savesResult] = await Promise.all([
      supabase.from("closet_items").select("*").order("created_at", { ascending: false }),
      supabase.from("outfits").select("*, outfit_items(closet_item_id, closet_items(*))").order("created_at", { ascending: false }).limit(60),
      supabase.from("outfit_saves").select("outfit_id")
    ]);

    if (closetResult.error || feedResult.error || savesResult.error) {
      setStatus(closetResult.error?.message || feedResult.error?.message || savesResult.error?.message);
      return;
    }

    const outfits = feedResult.data || [];
    const profileIds = [...new Set(outfits.map((outfit) => outfit.user_id).filter(Boolean))];
    const profilesResult = profileIds.length
      ? await supabase.from("profiles").select("id, display_name, age_group, style_signal").in("id", profileIds)
      : { data: [], error: null };

    if (profilesResult.error) {
      setStatus(profilesResult.error.message);
      return;
    }

    const profilesById = new Map((profilesResult.data || []).map((userProfile) => [userProfile.id, userProfile]));

    setCloset(closetResult.data || []);
    setFeed(outfits.map((outfit) => ({ ...outfit, profiles: profilesById.get(outfit.user_id) })));
    setSaves((savesResult.data || []).map((save) => save.outfit_id));
  }

  async function handleAuth(event) {
    event.preventDefault();
    setStatus("");
    const credentials = { email: authForm.email, password: authForm.password };
    const result = authMode === "sign-up"
      ? await supabase.auth.signUp({
          ...credentials,
          options: {
            data: {
              display_name: authForm.displayName || authForm.email.split("@")[0]
            }
          }
        })
      : await supabase.auth.signInWithPassword(credentials);

    if (result.error) {
      setStatus(result.error.message);
      return;
    }

    if (authMode === "sign-up") {
      if (result.data.session) {
        setStatus("Account created. You are signed in.");
      } else {
        setAuthMode("sign-in");
        setStatus("Account created. Confirm your email, then sign in.");
      }
      return;
    }

    setStatus("Signed in.");
  }

  async function updateProfile(field, value) {
    const nextProfile = { ...profile, [field]: value };
    setProfile(nextProfile);
    const { error } = await supabase.from("profiles").update({ [field]: value }).eq("id", session.user.id);
    if (error) setStatus(error.message);
  }

  async function uploadPhoto(file, folder) {
    if (!file) return null;
    const extension = file.name.split(".").pop() || "jpg";
    const path = `${session.user.id}/${folder}/${crypto.randomUUID()}.${extension}`;
    const { error } = await supabase.storage.from("closet-photos").upload(path, file, { upsert: false });
    if (error) throw error;
    const { data } = supabase.storage.from("closet-photos").getPublicUrl(path);
    return data.publicUrl;
  }

  async function addClosetItem(event) {
    event.preventDefault();
    setStatus("Uploading closet item...");
    try {
      const imageUrl = await uploadPhoto(closetPhoto, "closet");
      const tags = closetForm.tags.split(",").map((tag) => tag.trim()).filter(Boolean);
      const { error } = await supabase.from("closet_items").insert({
        user_id: session.user.id,
        name: closetForm.name,
        category: closetForm.category,
        color: closetForm.color,
        image_url: imageUrl,
        tags
      });
      if (error) throw error;
      setClosetForm({ name: "", category: "top", color: "#426941", tags: "" });
      setClosetPhoto(null);
      await loadAppData();
      setStatus("Closet item added.");
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function postOutfit(event) {
    event.preventDefault();
    if (!outfitForm.itemIds.length) {
      setStatus("Select at least one closet item for the outfit.");
      return;
    }
    setStatus("Posting outfit...");
    try {
      const imageUrl = await uploadPhoto(outfitPhoto, "outfits");
      const { data: outfit, error } = await supabase
        .from("outfits")
        .insert({
          user_id: session.user.id,
          title: outfitForm.title,
          caption: outfitForm.caption,
          visibility: outfitForm.visibility,
          image_url: imageUrl
        })
        .select()
        .single();
      if (error) throw error;

      const rows = outfitForm.itemIds.map((closetItemId) => ({
        outfit_id: outfit.id,
        closet_item_id: closetItemId
      }));
      const { error: itemError } = await supabase.from("outfit_items").insert(rows);
      if (itemError) throw itemError;

      setOutfitForm({ title: "", caption: "", visibility: "public", itemIds: [] });
      setOutfitPhoto(null);
      await loadAppData();
      setActiveView("feed");
      setStatus("Outfit posted.");
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function toggleSave(outfitId) {
    const alreadySaved = saves.includes(outfitId);
    setSaves(alreadySaved ? saves.filter((id) => id !== outfitId) : [...saves, outfitId]);

    const result = alreadySaved
      ? await supabase.from("outfit_saves").delete().eq("outfit_id", outfitId).eq("user_id", session.user.id)
      : await supabase.from("outfit_saves").insert({ outfit_id: outfitId, user_id: session.user.id });

    if (result.error) {
      setStatus(result.error.message);
      await loadAppData();
    }
  }

  function toggleOutfitItem(itemId) {
    setOutfitForm((current) => ({
      ...current,
      itemIds: current.itemIds.includes(itemId)
        ? current.itemIds.filter((id) => id !== itemId)
        : [...current.itemIds, itemId]
    }));
  }

  if (!isSupabaseConfigured) {
    return <SetupMissing />;
  }

  if (!session) {
    return (
      <main className="auth-screen">
        <section className="auth-panel">
          <Logo />
          <p className="eyebrow">Real closet. Real outfits.</p>
          <h1>Own what you wear</h1>
          <form onSubmit={handleAuth} className="auth-form">
            {authMode === "sign-up" && (
              <input value={authForm.displayName} onChange={(event) => setAuthForm({ ...authForm, displayName: event.target.value })} placeholder="Display name" />
            )}
            <input type="email" value={authForm.email} onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })} placeholder="Email" required />
            <input type="password" value={authForm.password} onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })} placeholder="Password" required minLength={6} />
            <button type="submit">{authMode === "sign-up" ? "Create account" : "Sign in"}</button>
          </form>
          <button className="text-button" type="button" onClick={() => setAuthMode(authMode === "sign-up" ? "sign-in" : "sign-up")}>
            {authMode === "sign-up" ? "Already have an account? Sign in" : "Need an account? Create one"}
          </button>
          {status && <p className="status">{status}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="rail">
        <Logo />
        <nav className="nav-tabs">
          {["feed", "closet", "styler", "post", "saved"].map((view) => (
            <button key={view} className={activeView === view ? "active" : ""} onClick={() => setActiveView(view)}>
              {view}
            </button>
          ))}
        </nav>
        <section className="profile-panel">
          <p className="eyebrow">Profile</p>
          <h2>{profile?.display_name || "Stylist"}</h2>
          <label>
            Age group
            <select value={profile?.age_group || "25-34"} onChange={(event) => updateProfile("age_group", event.target.value)}>
              {ageGroups.map((ageGroup) => <option key={ageGroup}>{ageGroup}</option>)}
            </select>
          </label>
          <label>
            Style signal
            <select value={profile?.style_signal || "minimal street"} onChange={(event) => updateProfile("style_signal", event.target.value)}>
              {styleSignals.map((styleSignal) => <option key={styleSignal}>{styleSignal}</option>)}
            </select>
          </label>
          <button className="secondary-button" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </section>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{activeView}</p>
            <h1>{viewTitle(activeView)}</h1>
          </div>
          <button className="primary-action" onClick={() => setActiveView("post")}>Post outfit</button>
        </header>

        {status && <p className="status">{status}</p>}
        {activeView === "feed" && <FeedView feed={feed} saves={saves} onSave={toggleSave} currentUserId={session.user.id} />}
        {activeView === "closet" && <ClosetView closet={closet} form={closetForm} setForm={setClosetForm} setPhoto={setClosetPhoto} onSubmit={addClosetItem} />}
        {activeView === "styler" && <StylerView recommendation={recommendation} saves={saves.length} />}
        {activeView === "post" && <PostView closet={closet} form={outfitForm} setForm={setOutfitForm} setPhoto={setOutfitPhoto} onSubmit={postOutfit} onToggleItem={toggleOutfitItem} />}
        {activeView === "saved" && <FeedView feed={feed.filter((outfit) => saves.includes(outfit.id))} saves={saves} onSave={toggleSave} currentUserId={session.user.id} emptyText="No saved outfits yet." />}
      </section>
    </main>
  );
}

function SetupMissing() {
  return (
    <main className="auth-screen">
      <section className="auth-panel">
        <Logo />
        <h1>Connect Supabase</h1>
        <p>Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to `.env.local` for local work and to Netlify environment variables for deployment.</p>
      </section>
    </main>
  );
}

function Logo() {
  return (
    <div className="brand">
      <span className="brand-mark">own<span className="brand-arrow">↑</span></span>
      <span>OwnUp</span>
    </div>
  );
}

function FeedView({ feed, saves, onSave, currentUserId, emptyText = "No public outfits yet. Post one from your closet." }) {
  if (!feed.length) return <p className="empty-state">{emptyText}</p>;
  return (
    <section className="feed-grid">
      {feed.map((outfit) => {
        const items = outfit.outfit_items?.map((entry) => entry.closet_items).filter(Boolean) || [];
        const isSaved = saves.includes(outfit.id);
        return (
          <article className="outfit-card" key={outfit.id}>
            <OutfitImage outfit={outfit} items={items} />
            <div className="outfit-body">
              <p className="eyebrow">{outfit.profiles?.display_name || "OwnUp user"} · {outfit.profiles?.age_group || "style match"}</p>
              <h2>{outfit.title}</h2>
              <p>{outfit.caption || "Recreated with owned closet pieces."}</p>
              <div className="chip-row">
                {items.map((item) => <span className="chip" key={item.id}>{item.name}</span>)}
              </div>
              <button className={isSaved ? "saved-button active" : "saved-button"} onClick={() => onSave(outfit.id)} disabled={outfit.user_id === currentUserId}>
                {outfit.user_id === currentUserId ? "Your post" : isSaved ? "Saved" : "Save look"}
              </button>
            </div>
          </article>
        );
      })}
    </section>
  );
}

function ClosetView({ closet, form, setForm, setPhoto, onSubmit }) {
  return (
    <section className="split-view">
      <form className="panel-form" onSubmit={onSubmit}>
        <h2>Add closet piece</h2>
        <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Item name" required />
        <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
          {categories.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
        <input type="color" value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} />
        <input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="Tags, comma separated" />
        <input type="file" accept="image/*" onChange={(event) => setPhoto(event.target.files?.[0] || null)} />
        <button type="submit">Upload item</button>
      </form>
      <div className="closet-grid">
        {closet.map((item) => <ItemCard item={item} key={item.id} />)}
      </div>
    </section>
  );
}

function StylerView({ recommendation, saves }) {
  return (
    <section className="styler-board">
      <article className="styler-summary">
        <p className="eyebrow">AI styler pattern</p>
        <h2>{saves ? "Based on saved looks and your closet" : "Based on your closet"}</h2>
        <p>Recommendations use owned categories, saved outfit language, profile age group, and style signal. This can later be replaced by an AI endpoint.</p>
      </article>
      <div className="recommend-grid">
        {recommendation.map((item) => <ItemCard item={item} key={item.id} reason={item.reason} />)}
      </div>
    </section>
  );
}

function PostView({ closet, form, setForm, setPhoto, onSubmit, onToggleItem }) {
  return (
    <form className="panel-form post-form" onSubmit={onSubmit}>
      <h2>Create outfit post</h2>
      <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Outfit title" required />
      <textarea value={form.caption} onChange={(event) => setForm({ ...form, caption: event.target.value })} placeholder="Caption" rows="3" />
      <select value={form.visibility} onChange={(event) => setForm({ ...form, visibility: event.target.value })}>
        <option value="public">public</option>
        <option value="private">private</option>
      </select>
      <input type="file" accept="image/*" onChange={(event) => setPhoto(event.target.files?.[0] || null)} />
      <div className="select-grid">
        {closet.map((item) => (
          <label className="select-card" key={item.id}>
            <input type="checkbox" checked={form.itemIds.includes(item.id)} onChange={() => onToggleItem(item.id)} />
            <ItemVisual item={item} />
            <span>{item.name}</span>
          </label>
        ))}
      </div>
      <button type="submit">Post outfit</button>
    </form>
  );
}

function ItemCard({ item, reason }) {
  return (
    <article className="item-card">
      <ItemVisual item={item} />
      <h2>{item.name}</h2>
      <p>{item.category}{reason ? ` · ${reason}` : ""}</p>
    </article>
  );
}

function ItemVisual({ item }) {
  if (item.image_url) {
    return <div className="item-visual"><img src={item.image_url} alt={item.name} /></div>;
  }
  return <div className="item-visual fallback" style={{ "--item-color": item.color }} aria-hidden="true" />;
}

function OutfitImage({ outfit, items }) {
  if (outfit.image_url) {
    return <div className="outfit-image"><img src={outfit.image_url} alt={outfit.title} /></div>;
  }
  return (
    <div className="outfit-image collage">
      {items.slice(0, 4).map((item) => <ItemVisual item={item} key={item.id} />)}
    </div>
  );
}

function viewTitle(view) {
  return {
    feed: "Looks from real closets",
    closet: "Your digital closet",
    styler: "Styler recommendations",
    post: "Post a real outfit",
    saved: "Saved looks"
  }[view];
}

createRoot(document.getElementById("root")).render(<App />);
