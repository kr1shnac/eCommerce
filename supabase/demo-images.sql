-- =============================================================================
-- Demo product photos -- DEVELOPMENT ONLY, never run on production
-- =============================================================================
-- WHAT THIS IS
--   Sets products.image_url to the public URL of a photo uploaded to the
--   `product-images` Storage bucket under seed/<slug>.jpg.
--
-- WHY IT IS NOT A MIGRATION
--   A migration is structure that every environment must have. These are 28
--   stock photographs used to make a local/demo shop look furnished; a real
--   shop photographs its own shelves. Migrations are append-only and numbered;
--   this file is neither, and it is safe to re-run.
--
-- HOW TO RUN
--   Paste into the Supabase SQL editor on a DEVELOPMENT project. (On the hosted
--   project these values were written through the REST API as the owner account,
--   so `product_images_admin_write` is what allowed it -- the same thing this
--   file does with SQL.)
--
-- THE PICTURES
--   CC0 / public-domain stock (a few CC BY / BY-SA), fetched from Openverse and
--   Wikimedia Commons, centre-cropped and resized to 640x640 JPEG. They were
--   chosen from candidate descriptions, NOT eyeballed one by one -- treat this
--   as a starting point and swap anything wrong via the app's admin photo
--   screen (apps/mobile/src/app/admin/photos.tsx).
--
--   A product with no picture deliberately keeps image_url NULL: its emoji is
--   the fallback, and a wrong photograph is worse than a drawn one. That is
--   exactly six products -- paneer, butter, mustard-oil, chilli-powder,
--   mixture-namkeen and coffee-powder -- whose search results were all the
--   wrong thing.
--
--   Sources and licences are listed at the bottom of this file.
--
-- THE EMOJI STAY
--   products.emoji is not replaced by this file. A photo always wins on screen,
--   but the emoji remains the tile for anything without one, so a picture can be
--   removed at any time and the app still reads.
-- =============================================================================




update public.products
   set image_url = 'https://ncfjzbptbtvkjvnrwyyq.supabase.co/storage/v1/object/public/product-images/seed/banana.jpg'
 where id = '20000000-0000-4000-8000-000000000004';  -- banana

update public.products
   set image_url = 'https://ncfjzbptbtvkjvnrwyyq.supabase.co/storage/v1/object/public/product-images/seed/basmati-rice.jpg'
 where id = '20000000-0000-4000-8000-000000000011';  -- basmati-rice

update public.products
   set image_url = 'https://ncfjzbptbtvkjvnrwyyq.supabase.co/storage/v1/object/public/product-images/seed/bathing-soap.jpg'
 where id = '20000000-0000-4000-8000-000000000033';  -- bathing-soap

update public.products
   set image_url = 'https://ncfjzbptbtvkjvnrwyyq.supabase.co/storage/v1/object/public/product-images/seed/biscuits.jpg'
 where id = '20000000-0000-4000-8000-000000000022';  -- biscuits

update public.products
   set image_url = 'https://ncfjzbptbtvkjvnrwyyq.supabase.co/storage/v1/object/public/product-images/seed/cream-crackers.jpg'
 where id = '20000000-0000-4000-8000-000000000030';  -- cream-crackers

update public.products
   set image_url = 'https://ncfjzbptbtvkjvnrwyyq.supabase.co/storage/v1/object/public/product-images/seed/curd.jpg'
 where id = '20000000-0000-4000-8000-000000000007';  -- curd

update public.products
   set image_url = 'https://ncfjzbptbtvkjvnrwyyq.supabase.co/storage/v1/object/public/product-images/seed/detergent-powder.jpg'
 where id = '20000000-0000-4000-8000-000000000032';  -- detergent-powder

update public.products
   set image_url = 'https://ncfjzbptbtvkjvnrwyyq.supabase.co/storage/v1/object/public/product-images/seed/dishwash-bar.jpg'
 where id = '20000000-0000-4000-8000-000000000031';  -- dishwash-bar

update public.products
   set image_url = 'https://ncfjzbptbtvkjvnrwyyq.supabase.co/storage/v1/object/public/product-images/seed/drinking-chocolate.jpg'
 where id = '20000000-0000-4000-8000-000000000027';  -- drinking-chocolate

update public.products
   set image_url = 'https://ncfjzbptbtvkjvnrwyyq.supabase.co/storage/v1/object/public/product-images/seed/full-cream-milk.jpg'
 where id = '20000000-0000-4000-8000-000000000006';  -- full-cream-milk

update public.products
   set image_url = 'https://ncfjzbptbtvkjvnrwyyq.supabase.co/storage/v1/object/public/product-images/seed/green-chilli.jpg'
 where id = '20000000-0000-4000-8000-000000000005';  -- green-chilli

update public.products
   set image_url = 'https://ncfjzbptbtvkjvnrwyyq.supabase.co/storage/v1/object/public/product-images/seed/iodised-salt.jpg'
 where id = '20000000-0000-4000-8000-000000000019';  -- iodised-salt

update public.products
   set image_url = 'https://ncfjzbptbtvkjvnrwyyq.supabase.co/storage/v1/object/public/product-images/seed/onion.jpg'
 where id = '20000000-0000-4000-8000-000000000002';  -- onion

update public.products
   set image_url = 'https://ncfjzbptbtvkjvnrwyyq.supabase.co/storage/v1/object/public/product-images/seed/potato.jpg'
 where id = '20000000-0000-4000-8000-000000000003';  -- potato

update public.products
   set image_url = 'https://ncfjzbptbtvkjvnrwyyq.supabase.co/storage/v1/object/public/product-images/seed/potato-chips.jpg'
 where id = '20000000-0000-4000-8000-000000000020';  -- potato-chips

update public.products
   set image_url = 'https://ncfjzbptbtvkjvnrwyyq.supabase.co/storage/v1/object/public/product-images/seed/roasted-peanuts.jpg'
 where id = '20000000-0000-4000-8000-000000000023';  -- roasted-peanuts

update public.products
   set image_url = 'https://ncfjzbptbtvkjvnrwyyq.supabase.co/storage/v1/object/public/product-images/seed/rusk.jpg'
 where id = '20000000-0000-4000-8000-000000000029';  -- rusk

update public.products
   set image_url = 'https://ncfjzbptbtvkjvnrwyyq.supabase.co/storage/v1/object/public/product-images/seed/soft-drink.jpg'
 where id = '20000000-0000-4000-8000-000000000026';  -- soft-drink

update public.products
   set image_url = 'https://ncfjzbptbtvkjvnrwyyq.supabase.co/storage/v1/object/public/product-images/seed/sona-masoori-rice.jpg'
 where id = '20000000-0000-4000-8000-000000000010';  -- sona-masoori-rice

update public.products
   set image_url = 'https://ncfjzbptbtvkjvnrwyyq.supabase.co/storage/v1/object/public/product-images/seed/sugar.jpg'
 where id = '20000000-0000-4000-8000-000000000012';  -- sugar

update public.products
   set image_url = 'https://ncfjzbptbtvkjvnrwyyq.supabase.co/storage/v1/object/public/product-images/seed/sunflower-oil.jpg'
 where id = '20000000-0000-4000-8000-000000000015';  -- sunflower-oil

update public.products
   set image_url = 'https://ncfjzbptbtvkjvnrwyyq.supabase.co/storage/v1/object/public/product-images/seed/tea-powder.jpg'
 where id = '20000000-0000-4000-8000-000000000024';  -- tea-powder

update public.products
   set image_url = 'https://ncfjzbptbtvkjvnrwyyq.supabase.co/storage/v1/object/public/product-images/seed/tomato.jpg'
 where id = '20000000-0000-4000-8000-000000000001';  -- tomato

update public.products
   set image_url = 'https://ncfjzbptbtvkjvnrwyyq.supabase.co/storage/v1/object/public/product-images/seed/toor-dal.jpg'
 where id = '20000000-0000-4000-8000-000000000013';  -- toor-dal

update public.products
   set image_url = 'https://ncfjzbptbtvkjvnrwyyq.supabase.co/storage/v1/object/public/product-images/seed/toothpaste.jpg'
 where id = '20000000-0000-4000-8000-000000000034';  -- toothpaste

update public.products
   set image_url = 'https://ncfjzbptbtvkjvnrwyyq.supabase.co/storage/v1/object/public/product-images/seed/turmeric-powder.jpg'
 where id = '20000000-0000-4000-8000-000000000017';  -- turmeric-powder

update public.products
   set image_url = 'https://ncfjzbptbtvkjvnrwyyq.supabase.co/storage/v1/object/public/product-images/seed/wheat-bread.jpg'
 where id = '20000000-0000-4000-8000-000000000028';  -- wheat-bread

update public.products
   set image_url = 'https://ncfjzbptbtvkjvnrwyyq.supabase.co/storage/v1/object/public/product-images/seed/wheat-flour.jpg'
 where id = '20000000-0000-4000-8000-000000000014';  -- wheat-flour


-- -----------------------------------------------------------------------------
-- Sources and licences
-- -----------------------------------------------------------------------------
-- slug | licence | title | landing page
-- banana                 | cc0 1.0      | Free bunch banana white background | https://www.rawpixel.com/image/5902390/photo-image-public-domain-plant-fruit
-- basmati-rice           | cc0 1.0      | Long grain basmati rice is displayed in bulk at a hypermarke | https://wordpress.org/photos/photo/37469274b0/
-- bathing-soap           | cc0 1.0      | File:Marseille soap bars (lemon verbena and lavender).jpg | https://commons.wikimedia.org/w/index.php?curid=50315563
-- biscuits               | cc0 1.0      | candy-biscuits-cookies-baking | https://www.flickr.com/photos/137643065@N06/23958714339
-- cream-crackers         | cc0 1.0      | Free cream cracker biscuit apple | https://www.rawpixel.com/image/5918984/photo-image-background-public-domain-food
-- curd                   | by-sa 4.0    | Perfect Curd yoghurt picture | https://commons.wikimedia.org/w/index.php?curid=40924835
-- detergent-powder       | by 2.0       | Ultra Tide Laundry Detergent | https://www.flickr.com/photos/39160147@N03/15194658582
-- dishwash-bar           | cc0 1.0      | Bath Soap | https://stocksnap.io/photo/bath-soap-BAP2TUBT3D
-- drinking-chocolate     | cc0 1.0      | Milk Chocolates in Glass | https://www.rawpixel.com/image/5968240/milk-chocolates-glass
-- full-cream-milk        | cc0 1.0      | Milk Splash | https://stocksnap.io/photo/milk-splash-0PIWORZOK5
-- green-chilli           | cc0 1.0      | A large pile of fresh green chilly peppers at a market, with | https://wordpress.org/photos/photo/8786a5ba36/
-- iodised-salt           | cc0 1.0      | salt crystals | https://www.flickr.com/photos/136594255@N06/28930758584
-- onion                  | cc0 1.0      | Ripe Onion White Background | https://www.rawpixel.com/image/5966197/ripe-onion-white-background
-- potato                 | cc0 1.0      | Free close potatoes white background | https://www.rawpixel.com/image/5902304/photo-image-background-public-domain-nature
-- potato-chips           | cc0          | Bowl of crispy potato chips served on brown paper, placed on | https://wordpress.org/photos/photo/1706a21704/
-- roasted-peanuts        | by-sa 3.0    | A photo of roasted peanut | https://commons.wikimedia.org/w/index.php?curid=17908197
-- rusk                   | by 2.0       | Zwieback (16232191529) | https://commons.wikimedia.org/w/index.php?curid=54313922
-- soft-drink             | cc0 1.0      | Coke bottle straw tropical beach | https://www.rawpixel.com/image/6113651/photo-image-public-domain-tropical-sky
-- sona-masoori-rice      | cc0 1.0      | File:A bowl of rice.jpg | https://commons.wikimedia.org/w/index.php?curid=43976882
-- sugar                  | by 2.0       | White-Sugar-Crystals 91637-480x360 (4905066798) | https://commons.wikimedia.org/w/index.php?curid=38382827
-- sunflower-oil          | CC BY-SA 4.0 | Bottle 1 liter Sunflower refined oil.jpg | https://commons.wikimedia.org/wiki/File:Bottle_1_liter_Sunflower_refined_oil.jpg
-- tea-powder             | cc0 1.0      | Formosa Alishan Premium Black | https://www.flickr.com/photos/76696276@N00/53680535584
-- tomato                 | cc0 1.0      | Closeup red tomatoes white background | https://www.rawpixel.com/image/6017278/photo-image-background-public-domain-red
-- toor-dal               | by 2.0       | Toor Dal | https://www.flickr.com/photos/38559542@N02/5193854525
-- toothpaste             | cc0 1.0      | Minimal toothpaste tube mockup psd in black and white | https://www.flickr.com/photos/57794015@N05/51913423154
-- turmeric-powder        | cc0 1.0      | Turmeric Powder | https://commons.wikimedia.org/w/index.php?curid=77984290
-- wheat-bread            | CC BY-SA 4.0 | Fresh Scali bread loaf from Winter Hill Bakery.jpg | https://commons.wikimedia.org/wiki/File:Fresh_Scali_bread_loaf_from_Winter_Hill_Bakery.jpg
-- wheat-flour            | cc0 1.0      | Wheat flour 01 | https://commons.wikimedia.org/w/index.php?curid=70950081
--
-- Images were downloaded from Openverse (https://openverse.org) and Wikimedia
-- Commons, then centre-cropped to a square and re-encoded at 640x640. CC0 and
-- public-domain images need no attribution; the CC BY / BY-SA ones are credited
-- above, which is the condition of their licence. Attribution is kept here
-- rather than in the app because these are demo assets, not shipped content.
