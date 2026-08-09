"use client";

import { useMemo, useState } from "react";

const inventory = [
  { id: "ST-1048", name: "1968 Ford Mustang Fastback", type: "Vehicles", zone: "Row C · Bay 12", price: "$18,500", status: "Available", note: "Complete body · project condition", x: 76, y: 26, tone: "amber" },
  { id: "ST-0891", name: "Structural I-Beam Bundle", type: "Materials", zone: "North Rack · N-04", price: "$1.85 / lb", status: "Available", note: "A36 steel · 12–18 ft lengths", x: 31, y: 21, tone: "blue" },
  { id: "ST-1212", name: "Vintage Neon Arrow", type: "Attractions", zone: "Showroom · Wall 2", price: "$2,400", status: "On hold", note: "Restored · working transformer", x: 59, y: 54, tone: "rose" },
  { id: "ST-1176", name: "Food Truck Court", type: "Food & Drink", zone: "Guest Plaza · P-03", price: "Open until 9 PM", status: "Open", note: "Tacos · barbecue · cold drinks", x: 42, y: 77, tone: "green" },
  { id: "ST-1103", name: "Pair of Industrial Gearboxes", type: "Equipment", zone: "Warehouse B · Shelf 7", price: "$3,200", status: "Available", note: "Inspected · 40:1 ratio", x: 84, y: 72, tone: "violet" },
];

const categories = ["All", "Vehicles", "Materials", "Equipment", "Attractions", "Food & Drink"];

export default function Home() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [selected, setSelected] = useState(inventory[0]);
  const filtered = useMemo(() => inventory.filter((item) =>
    (category === "All" || item.type === category) &&
    `${item.name} ${item.type} ${item.zone} ${item.id}`.toLowerCase().includes(query.toLowerCase())
  ), [query, category]);

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Lotkeeper home"><span className="brand-mark">LK</span><span>LOTKEEPER</span></a>
        <nav aria-label="Main navigation"><a className="active" href="#directory">Explore inventory</a><a href="#how">How it works</a><a href="#contact">Contact yard</a></nav>
        <a className="staff-button" href="/admin"><span>Staff sign in</span><b>↗</b></a>
      </header>

      <section className="hero" id="top">
        <div className="eyebrow"><span /> PUBLIC YARD DIRECTORY</div>
        <h1>Find what’s here.<br/><em>Know exactly where.</em></h1>
        <p>Search inventory, attractions, food, and events across the entire property—before you make the trip.</p>
        <label className="search"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a part, vehicle, attraction, or location…"/><kbd>⌘ K</kbd></label>
        <div className="quick-stats"><span><b>1,284</b> listed items</span><span><b>18</b> mapped zones</span><span className="open-dot"><b>Open today</b> until 6 PM</span></div>
      </section>

      <section className="directory" id="directory">
        <div className="directory-head">
          <div><div className="eyebrow dark"><span /> BROWSE THE YARD</div><h2>Everything has a place.</h2></div>
          <div className="chips" aria-label="Filter categories">{categories.map((c) => <button className={category === c ? "selected" : ""} onClick={() => setCategory(c)} key={c}>{c}</button>)}</div>
        </div>
        <div className="explorer">
          <div className="list-panel">
            <div className="list-meta"><span>{filtered.length} RESULTS</span><button>Sort: Featured⌄</button></div>
            <div className="cards">{filtered.map((item) => (
              <button key={item.id} onClick={() => setSelected(item)} className={`item-card ${selected.id === item.id ? "is-selected" : ""}`}>
                <span className={`item-icon ${item.tone}`}>{item.type === "Vehicles" ? "◫" : item.type === "Food & Drink" ? "♨" : "◆"}</span>
                <span className="item-copy"><small>{item.id} · {item.type}</small><strong>{item.name}</strong><span>{item.note}</span><b>⌖ {item.zone}</b></span>
                <span className="item-price"><strong>{item.price}</strong><small>{item.status}</small><i>›</i></span>
              </button>
            ))}</div>
          </div>
          <div className="map-panel" aria-label="Illustrated property map">
            <div className="map-grid" />
            <span className="map-label north">NORTH RACKS</span><span className="map-label warehouse">WAREHOUSE B</span><span className="map-label plaza">GUEST PLAZA</span><span className="map-label rows">VEHICLE ROWS</span>
            <div className="road road-one"/><div className="road road-two"/>
            {inventory.map((item) => <button aria-label={`${item.name}, ${item.zone}`} onClick={() => setSelected(item)} key={item.id} className={`pin ${selected.id === item.id ? "pin-active" : ""}`} style={{left: `${item.x}%`, top: `${item.y}%`}}><span>{item.id.split("-")[1]}</span></button>)}
            <div className="map-card"><small>SELECTED LOCATION</small><strong>{selected.zone}</strong><span>{selected.name}</span><button>Get directions →</button></div>
            <div className="map-tools"><button>＋</button><button>−</button><button>⌖</button></div>
            <div className="legend"><span><i className="available"/>Available</span><span><i className="hold"/>On hold</span><span><i className="public"/>Public amenity</span></div>
          </div>
        </div>
      </section>

      <section className="how" id="how"><div className="eyebrow"><span/> BUILT FOR REAL-WORLD PLACES</div><h2>One map. Any kind of yard.</h2><div className="use-cases"><article><b>01</b><h3>Salvage & parts</h3><p>Track vehicles, components, weights, prices, and exact rack or row locations.</p></article><article><b>02</b><h3>Dealer lots</h3><p>Give staff and shoppers a live, searchable view of every vehicle on the property.</p></article><article><b>03</b><h3>Parks & venues</h3><p>Help guests discover attractions, food, facilities, events, and accessibility details.</p></article></div></section>
      <footer id="contact"><div className="brand"><span className="brand-mark">LK</span><span>LOTKEEPER</span></div><p>A secure location-aware inventory template for places with a lot to keep track of.</p><a href="/admin">Open staff workspace →</a></footer>
    </main>
  );
}
