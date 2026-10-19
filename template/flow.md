## The wheel

Every card goes round six stages. The bar on a card shows how far round it is.

<ol class="wheel">
<li><span class="stage-bar" aria-hidden="true"><i class="on"></i><i></i><i></i><i></i><i></i><i></i></span><b>Plan</b><span class="wheel-does">A card: what it is, how big, and its "done when".</span><span class="wheel-say">You say what you want, and pick what's next.</span></li>
<li><span class="stage-bar" aria-hidden="true"><i class="on"></i><i class="on"></i><i></i><i></i><i></i><i></i></span><b>Design</b><span class="wheel-does">The approach, before any code. A card of 3 points or more waits for your yes.</span><span class="wheel-say">You pick an option.</span></li>
<li><span class="stage-bar" aria-hidden="true"><i class="on"></i><i class="on"></i><i class="on"></i><i></i><i></i><i></i></span><b>Develop</b><span class="wheel-does">Claude builds it.</span><span class="wheel-say">Nothing from you.</span></li>
<li><span class="stage-bar" aria-hidden="true"><i class="on"></i><i class="on"></i><i class="on"></i><i class="on"></i><i></i><i></i></span><b>Test</b><span class="wheel-does">The checks, then four screenshots: desktop and phone, dark and light.</span><span class="wheel-say">Nothing from you.</span></li>
<li><span class="stage-bar" aria-hidden="true"><i class="on"></i><i class="on"></i><i class="on"></i><i class="on"></i><i class="on"></i><i></i></span><b>Release</b><span class="wheel-does">Claude commits before your look. Deploy where there is a server, and a release note.</span><span class="wheel-say">You say <b>"ship it"</b> to deploy.</span></li>
<li><span class="stage-bar" aria-hidden="true"><i class="on"></i><i class="on"></i><i class="on"></i><i class="on"></i><i class="on"></i><i class="on"></i></span><b>Feedback</b><span class="wheel-does">Your look at the card. A retro when the milestone's last card is approved.</span><span class="wheel-say">You say <b>"#7 yes"</b> or what to fix, then <b>"retro"</b>.</span></li>
</ol>

Then round again: the retro's answers become the next plan.

## A session, start to finish

1. **Start.** Open Claude in the project's folder. The first line shows the project
   page's link, ready to open. Then say **"catch me up"**.
   Already in Claude? Type `/clear`, then say **"catch me up"**.
2. **Catch up.** Claude says where you left off, what moved, what waits on you and
   what's next, then asks what to work on. Pick an option, or say what you want.
3. **Work.** Claude moves the cards as it goes, and the project's page refreshes by itself.
4. **Look and decide.** When a card lands in *Waiting on you*, open its link and say
   "yes" or what to fix. Or say **"what needs me"**: Claude asks about every waiting
   card as multiple choice, with room for your own answer, then moves the cards.
5. **Commit.** Claude commits a card's work itself, before the card asks for your look.
   Say **"commit"** at any other time: Claude reads the changes, runs the checks, then
   commits and pushes.
6. **Deploy**, when it should go online. Say **"deploy"** or **"ship it"**. Claude runs
   the server steps, moves what went live to *Waiting on you*, and writes a release note.
7. **Save.** Say **"done for today"**. Claude tidies the board, writes the handoff note,
   commits and pushes, and gives you the line to start with next time and the page's link.

## If you forget to save

Did you turn on "Commit and push at session end" when you installed soloagile? Then
closing Claude, or typing `/clear`, still commits and pushes the board and the handoff
note. It doesn't tidy them first, so "done for today" is the better ending. With the
option off, nothing is saved until you say so. `/config` changes it.

## Words and commands

- **"catch me up"** or `/soloagile:catchup`: where things stand
- **"commit"** or `/soloagile:commit`: check, commit and push
- **"deploy"** or **"ship it"**: put it online, the way the project's own docs say, with a release note
- **"done for today"** or `/soloagile:save`: end the session
- **"what needs me"** or `/soloagile:needs`: answer everything waiting on you, as multiple choice
- **"retro"** or `/soloagile:retro`: when a milestone's last card is approved, look back and pick what's next
- `/soloagile:init`: gives a project its page, built from its old handoff files if it has any
- `/clear`: a new task that shares nothing with the last one
- **Esc Esc**: go back to before a wrong turn
