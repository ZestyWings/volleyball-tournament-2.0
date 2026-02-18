````md
# Git + GitHub One Page Cheat Sheet  
Zeth Satentes Development Workflow

---

## First Time Setup

```bash
git config --global user.name "Zeth Satentes"
git config --global user.email "your-email@example.com"
````

---

## Clone Project (Only Once)

```bash
git clone https://github.com/ZestyWings/volleyball-tournament-2.0.git
cd volleyball-tournament-2.0
code .
```

---

## Start Every Work Session

```bash
git pull origin main
```

---

## Check Status

```bash
git status
```

---

## Save and Push Changes

```bash
git add .
git commit -m "Describe your changes"
git push origin main
```

Example:

```bash
git commit -m "Support up to 16 teams"
```

---

## Professional Branch Workflow

Create branch:

```bash
git checkout -b feature-name
```

After editing:

```bash
git add .
git commit -m "Describe feature"
git push -u origin feature-name
```

Then open Pull Request on GitHub and merge into main.

---

## Switch Branches

```bash
git checkout main
```

---

## Update Main After Merge

```bash
git pull origin main
```

---

## See Current Branch

```bash
git branch
```

The branch with the star is active.

---

## Fix Push Rejected Error

```bash
git pull origin main
git add .
git commit -m "Resolve conflict"
git push origin main
```

---

## Delete Branch After Merge

Delete locally:

```bash
git branch -d feature-name
```

Delete on GitHub:

```bash
git push origin --delete feature-name
```

---

## Undo Last Commit (Not Pushed)

```bash
git reset --soft HEAD~1
```

---

## Discard All Local Changes (Use Carefully)

```bash
git reset --hard
```

---

## Daily Workflow Summary

```bash
git pull origin main
# make edits
git add .
git commit -m "Update logic"
git push origin main
```

---

## GitHub Pages Reminder

After pushing:

1. Wait up to two minutes
2. Hard refresh browser
3. Check repository Settings and Pages if site does not update

```

If you want this formatted to fit perfectly on a printable letter size page, I can tighten spacing even more.
```
