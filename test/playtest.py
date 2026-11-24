"""3인 온라인 대전 시뮬레이션 (가짜 Realtime으로 게임 로직 검증).
라운드1: 두 번째 힌트에서 도전자가 정답 → 맞힌 사람 +2
라운드2: 힌트 3개 다 써도 못 맞힘 → 출제자 +2
사용법: python3 test/playtest.py http://localhost:8766/ screenshots_dir"""
import asyncio, sys, json
from playwright.async_api import async_playwright

URL, OUT = sys.argv[1], sys.argv[2]
MOCK = open('test/mock-supabase.js', encoding='utf-8').read()


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 1280, 'height': 900})
        await ctx.route('**/supabase-js@*/**', lambda r: r.fulfill(body=MOCK, content_type='application/javascript'))
        errors = []
        pages = []
        names = ['주상', '민지', '서준']
        for i, nm in enumerate(names):
            pg = await ctx.new_page()
            pg.on('pageerror', lambda e, nm=nm: errors.append(f'{nm}: {e}'))
            pg.on('console', lambda m, nm=nm: m.type == 'error' and errors.append(f'{nm} console: {m.text}'))
            pages.append(pg)
        P1, P2, P3 = pages
        await P1.goto(URL)
        await P1.wait_for_function('document.getElementById("dictState").textContent.includes("준비됨")', timeout=60000)
        await P1.fill('#nameIn', '주상')
        await P1.click('button[value=create]')
        await P1.wait_for_selector('#s-room.on')
        code = await P1.inner_text('#roomCode')
        print('room', code)
        for pg, nm in [(P2, '민지'), (P3, '서준')]:
            await pg.goto(URL + '?room=' + code)
            await pg.wait_for_function('document.getElementById("dictState").textContent.includes("준비됨")', timeout=60000)
            await pg.fill('#nameIn', nm)
            await pg.click('button[value=join]')
        await P1.wait_for_function('window.__duel.S && window.__duel.S.players.length === 3', timeout=15000)
        print('lobby players:', await P1.inner_text('#players'))
        print('P3 sees:', (await P3.inner_text('#stage'))[:80].replace('\n', ' '))
        await P1.select_option('#setHints', '3')
        await P2.wait_for_function('window.__duel.S.maxHints === 3')
        await P1.screenshot(path=f'{OUT}/1-lobby.png')
        await P1.click('#startBtn')

        async def S(pg):
            return await pg.evaluate('JSON.parse(JSON.stringify(window.__duel.S))')

        async def pages_by_role():
            st = await S(P1)
            ids = [await pg.evaluate('window.__duel.ME.id') for pg in pages]
            setter = pages[ids.index(st['setterId'])]
            return setter, [pg for pg in pages if pg is not setter]

        async def play_round(win_on_hint):
            await P1.wait_for_function('window.__duel.S.phase === "choose"')
            setter, guessers = await pages_by_role()
            await setter.wait_for_selector('.card5')
            print('choices:', await setter.inner_text('.cards'))
            await setter.click('.card5 >> nth=0')
            await setter.wait_for_selector('#hintIn')
            ans = await setter.evaluate('Engine.W[window.__duel.A.s]')
            print('answer (setter only):', ans)
            leaked = [await g.evaluate('window.__duel.A') for g in guessers]
            print('guesser A is null:', all(x is None for x in leaked))
            # 나쁜 힌트 3번 → 제안 표시 확인
            for bad in ['컴퓨터', '자동차', ans]:
                await setter.fill('#hintIn', bad)
                await setter.press('#hintIn', 'Enter')
                print('  bad hint', bad, '->', await setter.inner_text('#hintMsg'))
            print('  suggest:', await setter.inner_text('#suggest'))
            hint_no = 0
            while True:
                hint_no += 1
                good = await setter.evaluate('''(() => { const A = window.__duel.A, ans = Engine.W[A.s];
                   const used = new Set(window.__duel.S.hints.map(h => h.word));
                   return A.top.slice(0, 51).map(i => Engine.W[i]).filter(w => !used.has(w) && !w.includes(ans) && !ans.includes(w))[0]; })()''')
                await setter.fill('#hintIn', good)
                await setter.press('#hintIn', 'Enter')
                for g in guessers:
                    await g.wait_for_selector('#guessIn')
                print(f'  hint {hint_no}:', good)
                for k, g in enumerate(guessers):
                    word = ans if (hint_no == win_on_hint and k == 0) else ['바다', '사람', '하늘', '음식', '학교', '시간'][hint_no + k]
                    await g.fill('#guessIn', word)
                    await g.press('#guessIn', 'Enter')
                await P1.wait_for_function(f'["hint","reveal"].includes(window.__duel.S.phase) && window.__duel.S.hints.length === {hint_no} && window.__duel.S.hints[{hint_no - 1}].guesses.length > 0', timeout=15000)
                st = await S(P1)
                print('   results:', [(g['word'], g['pct'], g['rank'], g['correct']) for g in st['hints'][-1]['guesses']])
                if st['phase'] == 'reveal':
                    break
            await guessers[0].screenshot(path=f'{OUT}/r{st["round"]}-reveal-guesser.png', full_page=True)
            print('reveal text:', (await guessers[1].inner_text('#stage'))[:160].replace('\n', ' | '))
            print('scores:', [(p['name'], p['score']) for p in st['players']])
            await P1.click('#nextBtn')

        await play_round(win_on_hint=2)
        # 라운드 2 도중 화면(진행 중) 캡처용: 못 맞히는 라운드
        await play_round(win_on_hint=99)
        await play_round(win_on_hint=1)
        await P1.wait_for_function('window.__duel.S.phase === "end"')
        print('final:', (await P2.inner_text('#stage')).replace('\n', ' | '))
        await P2.screenshot(path=f'{OUT}/end.png')
        # 폰 폭 확인
        await P3.set_viewport_size({'width': 390, 'height': 844})
        print('phone scrollWidth', await P3.evaluate('document.documentElement.scrollWidth'))
        await P3.screenshot(path=f'{OUT}/end-phone.png', full_page=True)
        print('errors:', errors)
        await b.close()

asyncio.run(main())
