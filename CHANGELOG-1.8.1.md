# TicketVault 1.8.1 — Oprava měny u prodeje z emailu

## 🐛 Bugfix

**Špatná konverze měny u StubHub prodeje.** Když byla vstupenka koupena v GBP (např.
Arsenal v Londýně), ale StubHub poslal výplatu v EUR (€136.40), aplikace si dosud
myslela, že prodejní cena je v librách. Pak ji převedla GBP → EUR kurzem ~1.158
a v dashboardu zobrazila ~157.91 € místo skutečných 136.40 €.

**Oprava:** Při schválení prodeje z inboxu se měna z emailu ukládá zvlášť do pole
`saleCurrency` (které už pro tento účel existuje a používá ho ruční prodejní modal).
Nákupní měna `ticket.currency` zůstává nedotčená. Dashboard pak správně počítá:
nákup v GBP × kurz GBP→EUR + prodej v EUR (bez konverze) = reálný profit.

**Co s existujícími záznamy:** Otevři postižené vstupenky přes Edit a zkontroluj
měnu u prodejní ceny. Případně je smaž a znovu přijmi z inboxu — tentokrát se
měna uloží správně.
