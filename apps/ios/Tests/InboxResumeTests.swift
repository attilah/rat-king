import XCTest
@testable import RatKing

final class InboxResumeTests: XCTestCase {
    // Generated append/reset/restart commands against a paged synthetic log. Each
    // restart reads `through` back from the encoded inbox file, as a cold launch does.
    @MainActor func testSavedCheckpointResumesAndALowerWatermarkReplaysFromZero() async throws {
        var seed: UInt64 = 151
        for _ in 0..<100 {
            var log: Int64 = 0, through: Int64 = 0, file: Data?
            for _ in 0..<30 {
                seed = seed &* 6364136223846793005 &+ 1
                switch (seed >> 32) % 4 {
                case 0: log += Int64((seed >> 40) % 250)
                case 1: log = Int64((seed >> 40) % UInt64(log + 1))
                default:
                    let saved = try file.map { try savedThrough(Value.json($0)) } ?? 0
                    XCTAssertEqual(saved, through)
                    let start = through > log ? 0 : through
                    var afterSeqs: [Int64] = [], seen: [Int64] = []
                    let high = try await listSnapshot(from: saved, list: { after, cursor in
                        afterSeqs.append(after)
                        let from = try cursor.map { try XCTUnwrap(Int64($0)) } ?? after, end = min(log, from + 100)
                        var page: [String: Value] = ["throughSeq": .int(log), "events": .array(end > from ? ((from + 1)...end).map { .int($0) } : [])]
                        if end < log { page["cursor"] = .string(String(end)) }
                        return .map(page)
                    }, page: { events, _ in seen += try events.map { try $0.number } })
                    XCTAssertEqual(high, log)
                    XCTAssertEqual(afterSeqs.first, through); XCTAssertEqual(afterSeqs.last, start); XCTAssertEqual(Set(afterSeqs.dropFirst()), afterSeqs.count > 1 ? [start] : [])
                    XCTAssertEqual(seen, start < log ? Array((start + 1)...log) : [])
                    through = log
                    file = try inboxFile(messages: [], copies: [], preferences: [:], through: high).jsonData()
                }
            }
        }
        let old = try Value.map(["messages": .array([]), "preferences": .map([:])]).jsonData()
        XCTAssertEqual(try savedThrough(Value.json(old)), 0)
    }
    // Cached rows show at once and stay put through sync, arrivals and reconnects;
    // new ids wait in pending until reveal. Only an empty cache shows the loader.
    func testCachedRowsStayVisibleWhileSyncing() {
        var seed: UInt64 = 211
        for _ in 0..<100 {
            seed = seed &* 6364136223846793005 &+ 1
            var ids = Array((0..<Int((seed >> 33) % 6)).reversed())
            var gate = InboxPresentation<Int>(); gate.resume(ids)
            var visible = ids, loading = ids.isEmpty
            XCTAssertEqual(gate.visible, visible); XCTAssertEqual(gate.loading, loading); XCTAssertEqual(gate.syncing, !loading)
            for _ in 0..<60 {
                seed = seed &* 6364136223846793005 &+ 1
                switch (seed >> 32) % 4 {
                case 0: ids.insert(ids.count, at: 0); gate.loaded(ids.count); gate.update(ids)
                case 1: gate.settle(ids); if loading { visible = ids; loading = false }
                case 2: gate.resume(ids); if visible.isEmpty { visible = ids; loading = ids.isEmpty }
                default: gate.reveal(ids); visible = ids; loading = false
                }
                XCTAssertEqual(gate.visible, visible); XCTAssertEqual(gate.loading, loading)
                if !loading { XCTAssertEqual(gate.pending, ids.filter { !visible.contains($0) }) }
            }
        }
    }
}
