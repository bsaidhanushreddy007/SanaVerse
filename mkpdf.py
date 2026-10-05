from reportlab.lib.pagesizes import A5
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
import textwrap, random
random.seed(1)
W,H=A5
words=("habit cue craving response reward small change system identity behavior every action begins with decision people often "
"think improvement requires massive action but remarkable results come from tiny gains compounding over time well-known").split()
def para(n):
    s=[]
    for _ in range(n):
        k=random.randint(8,16); w=[random.choice(words) for _ in range(k)]; w[0]=w[0].capitalize(); s.append(' '.join(w)+'.')
    return ' '.join(s)
c=canvas.Canvas('book.pdf',pagesize=A5); c.setTitle('Tiny Habits Test Book'); c.setAuthor('Jane Author')
pageno=[0]
def furniture():
    pageno[0]+=1
    c.setFont('Helvetica',8); c.drawString(40,H-28,'TINY HABITS TEST BOOK'); c.drawString(W/2-5,22,str(pageno[0]))
def body(lines,y,size=10):
    c.setFont('Times-Roman',size)
    for l in lines:
        if y<50: return y,lines[lines.index(l):]
        c.drawString(40,y,l); y-=size*1.35
    return y,[]
def wrapped(t): return textwrap.wrap(t,62)
# title page
furniture(); c.setFont('Helvetica-Bold',26); c.drawString(40,H-150,'Tiny Habits Test Book'); c.setFont('Helvetica',12); c.drawString(40,H-180,'Jane Author'); c.showPage()
chapters=[('CHAPTER 1','The Power of Habit'),('CHAPTER 2','Small Changes Matter'),('CHAPTER 3','Identity First')]
for ci,(a,b) in enumerate(chapters):
    furniture(); y=H-90
    c.setFont('Helvetica-Bold',22); c.drawString(40,y,a); y-=34; c.setFont('Helvetica-Bold',18); c.drawString(40,y,b); y-=40
    pending=[]
    for p in range(4): pending+=wrapped(para(5))+['']  # blank line = paragraph gap
    first=True
    while pending:
        if not first: c.showPage(); furniture(); y=H-60
        first=False
        c.setFont('Times-Roman',10)
        while pending and y>50:
            l=pending.pop(0)
            if l=='' : y-=10; continue
            c.drawString(40,y,l); y-=13.5
    c.showPage()
c.save()
# scanned-like pdf: image only
from PIL import Image
im=Image.new('RGB',(400,500),'white'); im.save('img.png')
c=canvas.Canvas('scanned.pdf',pagesize=A5)
for _ in range(3): c.drawImage('img.png',0,0,W,H); c.showPage()
c.save()
open('notpdf.pdf','wb').write(b'this is not a pdf at all')
open('notpdf.txt','w').write('hello')
print('ok')
