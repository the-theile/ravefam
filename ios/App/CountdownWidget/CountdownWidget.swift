import WidgetKit
import SwiftUI
import AppIntents

// ===== RAVE COUNTDOWN WIDGET =====
// Days until a crew's next rave: home screen (small / medium / large), lock
// screen (circular / rectangular / inline) and StandBy (small). Each widget
// can pin a crew (long-press → Edit Widget → Crew; a crew's next rave needs
// 2+ members going). The default is the raver's own next rave, and the large
// size lists one row per rave (`raves`). Data: CountdownModel.swift.

// MARK: - Crew picker

struct CrewEntity: AppEntity {
    static let soonestID = "soonest"
    static let soonest = CrewEntity(id: soonestID, name: "Soonest across my crews")

    let id: String
    let name: String

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Crew"
    static var defaultQuery = CrewQuery()

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)")
    }
}

struct CrewQuery: EntityQuery {
    func entities(for identifiers: [CrewEntity.ID]) async throws -> [CrewEntity] {
        let all = allEntities()
        return identifiers.compactMap { id in all.first { $0.id == id } }
    }

    func suggestedEntities() async throws -> [CrewEntity] {
        allEntities()
    }

    func defaultResult() async -> CrewEntity? {
        .soonest
    }

    private func allEntities() -> [CrewEntity] {
        let crews = CountdownStore.load()?.crews ?? []
        return [.soonest] + crews.map { CrewEntity(id: $0.id, name: $0.name) }
    }
}

struct SelectCrewIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Crew"
    static var description = IntentDescription("Pick which crew's next rave to count down to.")

    @Parameter(title: "Crew")
    var crew: CrewEntity?
}

// MARK: - Timeline

struct CountdownEntry: TimelineEntry {
    let date: Date
    let crews: [CountdownCrew]
    let raves: [CountdownRave]  // empty on files from builds before 2.39.1
    let pinnedID: String?      // nil = soonest across crews
    let hasData: Bool          // false until the app has synced once

    // Your raves that haven't ended yet (by local date), soonest first.
    var upcomingRaves: [CountdownRave] {
        raves.filter { $0.me != false && $0.asCrew.state(at: date).phase != .empty }
    }

    var selected: CountdownCrew? {
        if let id = pinnedID, let crew = crews.first(where: { $0.id == id }) { return crew }
        // Default: your own next rave.
        if let rave = upcomingRaves.first { return rave.asCrew }
        return sortedCrews(crews, at: date).first
    }

    var state: CountdownState {
        selected?.state(at: date) ?? CountdownState(phase: .empty, fest: nil)
    }

    var accent: Color { selected?.accent ?? Color(hex: nil) }

    // Who's coming, for the medium widget: the merged rave's subline
    // ("You + 3 · AKPsi, …"), or the crew count for a pinned crew.
    var whoLine: String? {
        if let id = pinnedID, crews.contains(where: { $0.id == id }) {
            guard let going = state.fest?.going, going > 0 else { return nil }
            return "\(going) of the crew going"
        }
        if let rave = upcomingRaves.first { return rave.subline }
        guard let going = state.fest?.going, going > 0 else { return nil }
        return "\(going) going"
    }

    static let sample = CountdownEntry(
        date: Date(),
        crews: [CountdownCrew(
            id: "sample", name: "Bass Fam", color: "#FF2D78",
            fests: [CountdownFest(
                name: "Hulaween",
                date: {
                    let day = Calendar.current.date(byAdding: .day, value: 23, to: Date()) ?? Date()
                    let c = Calendar.current.dateComponents([.year, .month, .day], from: day)
                    return String(format: "%04d-%02d-%02d", c.year ?? 2026, c.month ?? 1, c.day ?? 1)
                }(),
                days: 4, location: "Live Oak, FL", going: 6
            )]
        )],
        raves: [],
        pinnedID: nil,
        hasData: true
    )
}

struct CountdownProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> CountdownEntry {
        .sample
    }

    func snapshot(for configuration: SelectCrewIntent, in context: Context) async -> CountdownEntry {
        let file = CountdownStore.load()
        if file == nil && context.isPreview { return .sample }
        return entry(for: configuration, at: Date(), file: file)
    }

    func timeline(for configuration: SelectCrewIntent, in context: Context) async -> Timeline<CountdownEntry> {
        var file = CountdownStore.load()
        if let token = file?.token, let fresh = await CountdownStore.fetch(token: token) {
            file?.crews = fresh.crews ?? []
            file?.raves = fresh.raves
            file?.savedAt = Date().timeIntervalSince1970 * 1000
            if let updated = file { CountdownStore.save(updated) }
        }

        // One entry now, then one at each of the next 7 local midnights, so the
        // count rolls over on time even with no network. Refetch in 3 hours.
        let now = Date()
        let calendar = Calendar.current
        var dates = [now]
        var midnight = calendar.startOfDay(for: now)
        for _ in 0..<7 {
            guard let next = calendar.date(byAdding: .day, value: 1, to: midnight) else { break }
            midnight = next
            dates.append(midnight)
        }
        let entries = dates.map { entry(for: configuration, at: $0, file: file) }
        return Timeline(entries: entries, policy: .after(now.addingTimeInterval(3 * 3600)))
    }

    private func entry(for configuration: SelectCrewIntent, at date: Date, file: CountdownFile?) -> CountdownEntry {
        let pinned = configuration.crew?.id
        return CountdownEntry(
            date: date,
            crews: file?.crews ?? [],
            raves: file?.raves ?? [],
            pinnedID: pinned == CrewEntity.soonestID ? nil : pinned,
            hasData: file != nil
        )
    }
}

// MARK: - Views

private let bgColor = Color(red: 7 / 255, green: 7 / 255, blue: 12 / 255)
private let mutedColor = Color(red: 133 / 255, green: 133 / 255, blue: 165 / 255)

private func heavy(_ size: CGFloat) -> Font {
    .system(size: size, weight: .black, design: .rounded)
}

private func caps(_ size: CGFloat) -> Font {
    .system(size: size, weight: .heavy, design: .rounded)
}

struct CountdownWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: CountdownEntry

    var body: some View {
        content
            .widgetURL(entry.selected?.appURL ?? URL(string: "\(CountdownStore.site)/app"))
            .containerBackground(for: .widget) { background }
    }

    @ViewBuilder private var content: some View {
        switch family {
        case .systemMedium: MediumView(entry: entry)
        case .systemLarge: LargeView(entry: entry)
        case .accessoryCircular: CircularView(entry: entry)
        case .accessoryRectangular: RectangularView(entry: entry)
        case .accessoryInline: InlineView(entry: entry)
        default: SmallView(entry: entry)
        }
    }

    @ViewBuilder private var background: some View {
        switch family {
        case .accessoryCircular, .accessoryRectangular, .accessoryInline:
            Color.clear
        default:
            ZStack {
                bgColor
                RadialGradient(
                    colors: [entry.accent.opacity(0.34), .clear],
                    center: UnitPoint(x: 0.5, y: 1.15), startRadius: 0, endRadius: 200
                )
            }
        }
    }
}

private struct CrewTag: View {
    let name: String
    let accent: Color

    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(accent).frame(width: 7, height: 7).shadow(color: accent, radius: 3)
            Text(name.uppercased())
                .font(caps(10)).tracking(1.2).foregroundStyle(accent).lineLimit(1)
        }
    }
}

private struct BigNumber: View {
    let state: CountdownState
    let accent: Color
    let size: CGFloat

    var body: some View {
        Text(state.big)
            .font(heavy(state.isNumber ? size : size * 0.5))
            .foregroundStyle(.white)
            .shadow(color: accent.opacity(0.75), radius: 10)
            .lineLimit(1)
            .minimumScaleFactor(0.4)
    }
}

private struct NoDataView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("RAVEFAM").font(caps(10)).tracking(1.2).foregroundStyle(mutedColor)
            Spacer(minLength: 0)
            Text("Open RaveFAM to load your crews")
                .font(.system(size: 15, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

struct SmallView: View {
    let entry: CountdownEntry

    var body: some View {
        if !entry.hasData || entry.selected == nil {
            NoDataView()
        } else if let crew = entry.selected {
            let state = entry.state
            VStack(alignment: .leading, spacing: 0) {
                CrewTag(name: crew.name, accent: entry.accent)
                Spacer(minLength: 2)
                if state.fest == nil {
                    Text("No rave locked in yet")
                        .font(.system(size: 17, weight: .bold, design: .rounded))
                        .foregroundStyle(mutedColor)
                    Text("Tap → Dream Board").font(caps(11)).foregroundStyle(entry.accent)
                } else {
                    BigNumber(state: state, accent: entry.accent, size: 70)
                    Text(state.unit)
                        .font(caps(11)).tracking(1.4).foregroundStyle(entry.accent)
                        .lineLimit(1).minimumScaleFactor(0.6)
                    Text(state.fest?.name ?? "")
                        .font(.system(size: 14, weight: .heavy, design: .rounded))
                        .foregroundStyle(.white)
                        .lineLimit(2).minimumScaleFactor(0.8)
                        .padding(.top, 3)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
    }
}

struct MediumView: View {
    let entry: CountdownEntry

    var body: some View {
        if !entry.hasData || entry.selected == nil {
            NoDataView()
        } else if let crew = entry.selected {
            let state = entry.state
            HStack(alignment: .center, spacing: 14) {
                VStack(alignment: .leading, spacing: 2) {
                    BigNumber(state: state, accent: entry.accent, size: 96)
                    if state.fest != nil {
                        Text(state.unit)
                            .font(caps(11)).tracking(1.4).foregroundStyle(entry.accent)
                            .lineLimit(1).minimumScaleFactor(0.6)
                    }
                }
                .frame(width: 112, alignment: .leading)

                VStack(alignment: .leading, spacing: 3) {
                    CrewTag(name: crew.name, accent: entry.accent)
                    if let fest = state.fest {
                        Text(fest.name)
                            .font(.system(size: 19, weight: .heavy, design: .rounded))
                            .foregroundStyle(.white)
                            .lineLimit(2).minimumScaleFactor(0.8)
                        Text(fest.detailLine)
                            .font(.system(size: 12, weight: .medium)).foregroundStyle(mutedColor)
                            .lineLimit(1).minimumScaleFactor(0.85)
                        Spacer(minLength: 0)
                        if let hype = state.hype {
                            Text(hype)
                                .font(.system(size: 12, weight: .bold, design: .rounded)).foregroundStyle(entry.accent)
                                .lineLimit(1)
                        }
                        if let who = entry.whoLine {
                            Text(who)
                                .font(.system(size: 12, weight: .semibold)).foregroundStyle(Color.white.opacity(0.75))
                                .lineLimit(1).minimumScaleFactor(0.8)
                        }
                    } else {
                        Text("No rave locked in yet")
                            .font(.system(size: 17, weight: .heavy, design: .rounded)).foregroundStyle(mutedColor)
                        Spacer(minLength: 0)
                        Text("Tap to pick one on the Dream Board").font(.system(size: 12)).foregroundStyle(entry.accent)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
    }
}

struct LargeView: View {
    let entry: CountdownEntry

    var body: some View {
        if !entry.hasData || (entry.crews.isEmpty && entry.raves.isEmpty) {
            NoDataView()
        } else if entry.pinnedID == nil && !entry.upcomingRaves.isEmpty {
            // One row per rave you're going to, with who from your crews is coming.
            let raves = Array(entry.upcomingRaves.prefix(5))
            VStack(alignment: .leading, spacing: 8) {
                Text("Next up 🔊").font(heavy(22)).foregroundStyle(.white)
                ForEach(raves, id: \.self) { rave in
                    let crew = rave.asCrew
                    if let url = crew.appURL {
                        Link(destination: url) { LargeRow(crew: crew, date: entry.date, sub: rave.subline) }
                    } else {
                        LargeRow(crew: crew, date: entry.date, sub: rave.subline)
                    }
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        } else {
            let crews = Array(pinnedFirst.prefix(5))
            VStack(alignment: .leading, spacing: 8) {
                Text("Next up 🔊").font(heavy(22)).foregroundStyle(.white)
                ForEach(crews, id: \.id) { crew in
                    if let url = crew.appURL {
                        Link(destination: url) { LargeRow(crew: crew, date: entry.date) }
                    } else {
                        LargeRow(crew: crew, date: entry.date)
                    }
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    // A pinned crew leads the list; the rest stay soonest-first.
    private var pinnedFirst: [CountdownCrew] {
        let sorted = sortedCrews(entry.crews, at: entry.date)
        guard let id = entry.pinnedID, let pinned = sorted.first(where: { $0.id == id }) else { return sorted }
        return [pinned] + sorted.filter { $0.id != id }
    }
}

private struct LargeRow: View {
    let crew: CountdownCrew
    let date: Date
    var sub: String? = nil     // merged rows bring their own subline

    var body: some View {
        let state = crew.state(at: date)
        let accent = crew.accent
        HStack(spacing: 12) {
            VStack(alignment: .trailing, spacing: 1) {
                Text(rowBig(state)).font(heavy(26)).foregroundStyle(.white)
                    .shadow(color: accent.opacity(0.7), radius: 6).lineLimit(1).minimumScaleFactor(0.5)
                Text(rowUnit(state)).font(caps(8)).tracking(1).foregroundStyle(accent).lineLimit(1)
            }
            .frame(width: 58, alignment: .trailing)
            VStack(alignment: .leading, spacing: 2) {
                Text(state.fest?.name ?? "Nothing locked in")
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(state.fest == nil ? mutedColor : .white).lineLimit(1)
                Text(rowSub(state)).font(.system(size: 11, weight: .medium)).foregroundStyle(accent).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 14).fill(Color.white.opacity(0.04)))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(accent.opacity(0.3), lineWidth: 1))
    }

    private func rowBig(_ s: CountdownState) -> String {
        switch s.phase {
        case .countdown(let d): return "\(d)"
        case .today: return "NOW"
        case .live(let day, _): return "D\(day)"
        case .empty: return "—"
        }
    }

    private func rowUnit(_ s: CountdownState) -> String {
        switch s.phase {
        case .countdown(let d): return d == 1 ? "DAY" : "DAYS"
        case .today: return "TODAY"
        case .live(_, let of): return "OF \(of)"
        case .empty: return ""
        }
    }

    private func rowSub(_ s: CountdownState) -> String {
        if let sub = sub { return sub }
        guard let going = s.fest?.going, going > 0 else { return crew.name }
        return "\(crew.name) · \(going) going"
    }
}

struct CircularView: View {
    let entry: CountdownEntry

    var body: some View {
        let state = entry.state
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: 0) {
                switch state.phase {
                case .countdown(let d):
                    Text("\(d)").font(heavy(22)).minimumScaleFactor(0.5).lineLimit(1)
                    Text(d == 1 ? "DAY" : "DAYS").font(caps(8))
                case .today:
                    Text("🎉").font(.system(size: 18))
                    Text("TODAY").font(caps(8))
                case .live(let day, _):
                    Text("D\(day)").font(heavy(20))
                    Text("LIVE").font(caps(8))
                case .empty:
                    Text("—").font(heavy(20))
                }
            }
        }
        .widgetAccentable()
    }
}

struct RectangularView: View {
    let entry: CountdownEntry

    var body: some View {
        let state = entry.state
        VStack(alignment: .leading, spacing: 0) {
            Text(entry.selected?.name.uppercased() ?? "RAVEFAM").font(caps(10)).lineLimit(1).widgetAccentable()
            if let fest = state.fest {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(state.big).font(heavy(26)).lineLimit(1).minimumScaleFactor(0.6)
                    if state.isNumber { Text(state.unit).font(caps(10)).lineLimit(1) }
                }
                Text(fest.name).font(.system(size: 12, weight: .semibold)).lineLimit(1)
            } else {
                Text(entry.hasData ? "No rave locked in" : "Open RaveFAM")
                    .font(.system(size: 13, weight: .semibold)).lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct InlineView: View {
    let entry: CountdownEntry

    var body: some View {
        let state = entry.state
        if let fest = state.fest {
            switch state.phase {
            case .countdown(let d): Text("\(d) \(d == 1 ? "day" : "days") · \(fest.name)")
            case .today: Text("\(fest.name) is today 🎉")
            case .live(let day, let of): Text("\(fest.name) · day \(day) of \(of)")
            case .empty: Text("RaveFAM")
            }
        } else {
            Text(entry.hasData ? "No rave locked in" : "Open RaveFAM")
        }
    }
}

// MARK: - Widget

struct CountdownWidget: Widget {
    let kind = "CountdownWidget"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: kind, intent: SelectCrewIntent.self, provider: CountdownProvider()) { entry in
            CountdownWidgetView(entry: entry)
        }
        .configurationDisplayName("Rave Countdown")
        .description("Days until your crew's next rave.")
        .supportedFamilies([
            .systemSmall, .systemMedium, .systemLarge,
            .accessoryCircular, .accessoryRectangular, .accessoryInline,
        ])
    }
}

@main
struct CountdownWidgetBundle: WidgetBundle {
    var body: some Widget {
        CountdownWidget()
    }
}
