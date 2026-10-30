from pathlib import Path
from PIL import Image, ImageDraw
import sys
root=Path('output/playwright/issue-180')
for tag in sys.argv[1:] or ['pass-1']:
    folder=root/tag
    pairs=[]
    for built in sorted(folder.glob('*.png')):
        if built.name.startswith(('pair-','contact-')): continue
        width=int(built.stem.rsplit('-',1)[1])
        reference=root/('reference-phone-390.png' if width==390 else 'reference-desktop-1440.png')
        left=Image.open(reference).convert('RGB'); right=Image.open(built).convert('RGB')
        assert left.width==right.width,(built,left.size,right.size)
        height=max(left.height,right.height)
        pair=Image.new('RGB',(width*2,height+24),'white'); pair.paste(left,(0,24));pair.paste(right,(width,24));
        d=ImageDraw.Draw(pair);d.text((8,6),'Reference',fill='black');d.text((width+8,6),built.stem,fill='black')
        name=folder/f'pair-{built.name}';pair.save(name);pairs.append(name)
    for width in [1440,390]:
        selected=[p for p in pairs if p.stem.endswith(str(width))]
        for offset in range(0,len(selected),6):
            batch=selected[offset:offset+6]
            thumb_w=900 if width==1440 else 620
            thumbs=[]
            for p in batch:
                im=Image.open(p);im.thumbnail((thumb_w,650));thumbs.append(im)
            cell_h=max(im.height for im in thumbs)+22
            sheet=Image.new('RGB',(thumb_w*2,cell_h*3),'#dddddd');d=ImageDraw.Draw(sheet)
            for i,im in enumerate(thumbs):
                x=(i%2)*thumb_w;y=(i//2)*cell_h
                d.text((x+4,y+3),batch[i].stem,fill='black');sheet.paste(im,(x,y+20))
            sheet.save(folder/f'contact-{width}-{offset//6+1}.png')
    print(tag,len(pairs),'equal-size pairs')
