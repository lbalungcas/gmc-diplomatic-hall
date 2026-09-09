import bpy
import bmesh
import math
import os

BLEND_IN = r"c:\Users\Lawrence-S\Downloads\Game\diplomatic_hall_v10.blend"
BLEND_OUT = r"c:\Users\Lawrence-S\Downloads\Game\diplomatic_hall_v10_refined.blend"
TEXTURES_DIR = r"c:\Users\Lawrence-S\Downloads\Game\textures"
GLB_OUT_DIR = r"c:\Users\Lawrence-S\Downloads\Game\public\models"
os.makedirs(GLB_OUT_DIR, exist_ok=True)
GLB_OUT = os.path.join(GLB_OUT_DIR, "diplomatic_hall.glb")

print("Opening blend file:", BLEND_IN)
bpy.ops.wm.open_mainfile(filepath=BLEND_IN)

def get_or_create_image(filename):
    path = os.path.join(TEXTURES_DIR, filename)
    if not os.path.exists(path):
        print("Warning: image not found:", path)
        return None
    img = bpy.data.images.get(filename)
    if not img:
        img = bpy.data.images.load(path)
    return img

def create_pbr_material(name, base_color_img=None, color_val=None, normal_img=None, roughness_img=None, roughness=0.5, metallic=0.0, emission_img=None, emission_color=None, emission_strength=1.0, uv_scale=(1.0, 1.0)):
    # If material already exists, re-use or recreate clean nodes
    mat = bpy.data.materials.get(name)
    if not mat:
        mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    
    output_node = nodes.new(type='ShaderNodeOutputMaterial')
    output_node.location = (600, 0)
    
    bsdf = nodes.new(type='ShaderNodeBsdfPrincipled')
    bsdf.location = (200, 0)
    links.new(bsdf.outputs['BSDF'], output_node.inputs['Surface'])
    
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    
    if color_val:
        bsdf.inputs['Base Color'].default_value = color_val
        
    tex_coord = None
    mapping = None
    if uv_scale != (1.0, 1.0):
        tex_coord = nodes.new(type='ShaderNodeTexCoord')
        tex_coord.location = (-700, 0)
        mapping = nodes.new(type='ShaderNodeMapping')
        mapping.location = (-500, 0)
        mapping.inputs['Scale'].default_value = (uv_scale[0], uv_scale[1], 1.0)
        links.new(tex_coord.outputs['UV'], mapping.inputs['Vector'])
    
    # Base Color Texture
    if base_color_img:
        tex_node = nodes.new(type='ShaderNodeTexImage')
        tex_node.location = (-200, 200)
        tex_node.image = base_color_img
        if mapping:
            links.new(mapping.outputs['Vector'], tex_node.inputs['Vector'])
        links.new(tex_node.outputs['Color'], bsdf.inputs['Base Color'])
    
    # Roughness Map
    if roughness_img:
        r_node = nodes.new(type='ShaderNodeTexImage')
        r_node.location = (-200, -50)
        r_node.image = roughness_img
        r_node.image.colorspace_settings.name = 'Non-Color'
        if mapping:
            links.new(mapping.outputs['Vector'], r_node.inputs['Vector'])
        links.new(r_node.outputs['Color'], bsdf.inputs['Roughness'])
        
    # Normal Map
    if normal_img:
        n_node = nodes.new(type='ShaderNodeTexImage')
        n_node.location = (-300, -300)
        n_node.image = normal_img
        n_node.image.colorspace_settings.name = 'Non-Color'
        if mapping:
            links.new(mapping.outputs['Vector'], n_node.inputs['Vector'])
            
        norm_map = nodes.new(type='ShaderNodeNormalMap')
        norm_map.location = (-50, -300)
        norm_map.inputs['Strength'].default_value = 1.0
        links.new(n_node.outputs['Color'], norm_map.inputs['Color'])
        links.new(norm_map.outputs['Normal'], bsdf.inputs['Normal'])
        
    # Emission
    if emission_img:
        em_tex = nodes.new(type='ShaderNodeTexImage')
        em_tex.location = (-200, 450)
        em_tex.image = emission_img
        links.new(em_tex.outputs['Color'], bsdf.inputs['Emission Color'])
        if 'Emission Strength' in bsdf.inputs:
            bsdf.inputs['Emission Strength'].default_value = emission_strength
    elif emission_color:
        bsdf.inputs['Emission Color'].default_value = emission_color
        if 'Emission Strength' in bsdf.inputs:
            bsdf.inputs['Emission Strength'].default_value = emission_strength
            
    return mat

print("=== 1. Texturing Floors ===")
# Hall Floor (Carpet)
hall_floor = bpy.data.objects.get("Hall_Floor")
if hall_floor:
    carpet_img = get_or_create_image("carpet_hall.png")
    carpet_norm = get_or_create_image("carpet_normal.png")
    carpet_rough = get_or_create_image("carpet_roughness.png")
    mat_carpet = create_pbr_material("Mat_Hall_Carpet", base_color_img=carpet_img, normal_img=carpet_norm, roughness_img=carpet_rough, roughness=0.85, uv_scale=(8.0, 10.0))
    if hall_floor.data.materials:
        hall_floor.data.materials[0] = mat_carpet
    else:
        hall_floor.data.materials.append(mat_carpet)

# Corridor Floor (Marble Tile)
corridor_floor = bpy.data.objects.get("Corridor_Floor")
if corridor_floor:
    tile_img = get_or_create_image("corridor_tile.png")
    tile_norm = get_or_create_image("tile_normal.png")
    tile_rough = get_or_create_image("tile_roughness.png")
    mat_tile = create_pbr_material("Mat_Corridor_Tile", base_color_img=tile_img, normal_img=tile_norm, roughness_img=tile_rough, roughness=0.18, metallic=0.08, uv_scale=(4.0, 10.0))
    if corridor_floor.data.materials:
        corridor_floor.data.materials[0] = mat_tile
    else:
        corridor_floor.data.materials.append(mat_tile)

print("=== 2. Texturing All Walls & Steps ===")
wall_img = get_or_create_image("wall_panel.png")
wall_norm = get_or_create_image("wall_normal.png")
wall_rough = get_or_create_image("wall_roughness.png")
mat_wall = create_pbr_material("Mat_Acoustic_Wall", base_color_img=wall_img, normal_img=wall_norm, roughness_img=wall_rough, roughness=0.6, uv_scale=(6.0, 2.0))

wall_count = 0
for obj in bpy.data.objects:
    if obj.type == 'MESH':
        is_wall_obj = (
            obj.name.startswith("W_") or 
            obj.name.startswith("Step_") or 
            "Wall" in obj.name or 
            obj.name.startswith("EX_") or
            obj.name.startswith("DoorMark")
        ) and obj.name != "W_StageWall"
        
        has_wall_mat = any(s.material and s.material.name == "Wall" for s in obj.material_slots)
        
        if is_wall_obj or has_wall_mat:
            wall_count += 1
            if obj.material_slots:
                for slot in obj.material_slots:
                    if slot.material and (slot.material.name == "Wall" or "wall" in slot.material.name.lower() or is_wall_obj):
                        slot.material = mat_wall
            else:
                obj.data.materials.append(mat_wall)
print(f"Applied Mat_Acoustic_Wall to {wall_count} wall/step objects.")

print("=== 3. Texturing Stage, Backdrop & Lectern ===")
backdrop_img = get_or_create_image("stage_backdrop.png")
mat_stage_wall = create_pbr_material("Mat_Stage_Backdrop", base_color_img=backdrop_img, roughness=0.35, emission_img=backdrop_img, emission_strength=0.25)

stage_wall = bpy.data.objects.get("W_StageWall")
if stage_wall:
    if stage_wall.data.materials:
        stage_wall.data.materials[0] = mat_stage_wall
    else:
        stage_wall.data.materials.append(mat_stage_wall)

for o in bpy.data.objects:
    if o.name.startswith("BackdropPanel"):
        if o.data.materials:
            o.data.materials[0] = mat_stage_wall

stage_wood_img = get_or_create_image("wood_stage.png")
stage_wood_norm = get_or_create_image("wood_stage_normal.png")
stage_wood_rough = get_or_create_image("wood_stage_roughness.png")
mat_stage_wood = create_pbr_material("Mat_Stage_Wood", base_color_img=stage_wood_img, normal_img=stage_wood_norm, roughness_img=stage_wood_rough, roughness=0.35, metallic=0.05, uv_scale=(4.0, 3.0))

for s_name in ["Stage", "Podium", "Stair_Landing", "Stair_Rail"]:
    obj = bpy.data.objects.get(s_name)
    if obj and obj.type == 'MESH':
        if obj.data.materials:
            obj.data.materials[0] = mat_stage_wood
        else:
            obj.data.materials.append(mat_stage_wood)

print("=== 4. Texturing 20 Booths ===")
# Shared Booth Materials
mat_frame = bpy.data.materials.get("B_Frame")
if mat_frame and mat_frame.node_tree:
    for n in mat_frame.node_tree.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            n.inputs['Base Color'].default_value = (0.78, 0.80, 0.84, 1.0)
            n.inputs['Metallic'].default_value = 0.88
            n.inputs['Roughness'].default_value = 0.22

mat_counter = bpy.data.materials.get("B_Counter")
if mat_counter and mat_counter.node_tree:
    for n in mat_counter.node_tree.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            n.inputs['Base Color'].default_value = (0.32, 0.20, 0.12, 1.0)
            n.inputs['Metallic'].default_value = 0.05
            n.inputs['Roughness'].default_value = 0.40

mat_stool = bpy.data.materials.get("B_Stool")
if mat_stool and mat_stool.node_tree:
    for n in mat_stool.node_tree.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            n.inputs['Base Color'].default_value = (0.10, 0.12, 0.16, 1.0)
            n.inputs['Roughness'].default_value = 0.75

mat_light = bpy.data.materials.get("B_Light")
if mat_light and mat_light.node_tree:
    for n in mat_light.node_tree.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            n.inputs['Base Color'].default_value = (1.0, 0.98, 0.92, 1.0)
            n.inputs['Emission Color'].default_value = (1.0, 0.96, 0.85, 1.0)
            if 'Emission Strength' in n.inputs:
                n.inputs['Emission Strength'].default_value = 6.0

for i in range(1, 21):
    booth_name = f"Booth_{i:02d}"
    booth_obj = bpy.data.objects.get(booth_name)
    if not booth_obj:
        continue
    
    graphic_img = get_or_create_image(f"booth_{i:02d}_graphic.png")
    mat_graphic = create_pbr_material(f"Mat_{booth_name}_Graphic", base_color_img=graphic_img, roughness=0.3, emission_img=graphic_img, emission_strength=0.35)
    
    screen_img = get_or_create_image(f"booth_{i:02d}_screen.png")
    mat_screen = create_pbr_material(f"Mat_{booth_name}_Screen", base_color_img=screen_img, roughness=0.18, emission_img=screen_img, emission_strength=1.3)
    
    for slot_idx, slot in enumerate(booth_obj.material_slots):
        if slot.material:
            if "graphic" in slot.material.name.lower() or slot_idx == 1:
                booth_obj.material_slots[slot_idx].material = mat_graphic
            elif "screen" in slot.material.name.lower() or slot_idx == 5:
                booth_obj.material_slots[slot_idx].material = mat_screen

print("=== 5. Texturing Welcome Desk & Commitment Wall ===")
welcome_desk = bpy.data.objects.get("Welcome_Desk")
if welcome_desk:
    desk_img = get_or_create_image("welcome_desk.png")
    mat_desk = create_pbr_material("Mat_Welcome_Desk", base_color_img=desk_img, roughness=0.3, emission_img=desk_img, emission_strength=0.2)
    if welcome_desk.data.materials:
        welcome_desk.data.materials[0] = mat_desk

comm_wall = bpy.data.objects.get("Commitment_Wall")
if comm_wall:
    comm_img = get_or_create_image("commitment_wall.png")
    mat_comm = create_pbr_material("Mat_Commitment_Wall", base_color_img=comm_img, roughness=0.4)
    if comm_wall.data.materials:
        comm_wall.data.materials[0] = mat_comm

print("=== 6. Texturing Media Hub, Banquet Chairs & Tables ===")
media_hub = bpy.data.objects.get("Media_Hub")
if media_hub:
    media_img = get_or_create_image("media_hub.png")
    mat_media = create_pbr_material("Mat_Media_Hub", base_color_img=media_img, roughness=0.3, emission_img=media_img, emission_strength=0.3)
    for slot in media_hub.material_slots:
        if slot.material and ("backdrop" in slot.material.name.lower() or "rug" in slot.material.name.lower() or "panel" in slot.material.name.lower()):
            slot.material = mat_media

linen_img = get_or_create_image("table_linen.png")
mat_linen = create_pbr_material("Mat_Table_Linen", base_color_img=linen_img, roughness=0.85, uv_scale=(4.0, 4.0))
for o in bpy.data.objects:
    if "Table_C_Dressed" in o.name:
        for slot in o.material_slots:
            if slot.material and "linen" in slot.material.name.lower():
                slot.material = mat_linen

for mat in bpy.data.materials:
    if "frame_champagne" in mat.name.lower():
        if mat.node_tree:
            for n in mat.node_tree.nodes:
                if n.type == 'BSDF_PRINCIPLED':
                    n.inputs['Base Color'].default_value = (0.88, 0.78, 0.58, 1.0) # Champagne gold
                    n.inputs['Metallic'].default_value = 0.92
                    n.inputs['Roughness'].default_value = 0.22
    elif "upholstery_cream" in mat.name.lower():
        if mat.node_tree:
            for n in mat.node_tree.nodes:
                if n.type == 'BSDF_PRINCIPLED':
                    n.inputs['Base Color'].default_value = (0.94, 0.92, 0.88, 1.0)
                    n.inputs['Roughness'].default_value = 0.80
    elif "blackcloth" in mat.name.lower():
        if mat.node_tree:
            for n in mat.node_tree.nodes:
                if n.type == 'BSDF_PRINCIPLED':
                    n.inputs['Base Color'].default_value = (0.05, 0.05, 0.06, 1.0)
                    n.inputs['Roughness'].default_value = 0.90

print("=== 7. Adding Full Venue Ceiling Mesh with Recessed Lighting ===")
# Remove existing ceiling object if any
existing_ceil = bpy.data.objects.get("Venue_Ceiling")
if existing_ceil:
    bpy.data.objects.remove(existing_ceil, do_unlink=True)

ceil_mesh = bpy.data.meshes.new("Venue_Ceiling_Mesh")
ceil_obj = bpy.data.objects.new("Venue_Ceiling", ceil_mesh)
bpy.context.scene.collection.objects.link(ceil_obj)

bm = bmesh.new()

# Create two rectangular planes at Z = 3.5m facing DOWN (-Z in Blender)
# 1. Main Hall: X=[0.0, 19.35], Y=[0.0, 25.5], Z=3.5
# Face normal points DOWN towards floor
v1 = bm.verts.new((0.0, 0.0, 3.5))
v2 = bm.verts.new((19.35, 0.0, 3.5))
v3 = bm.verts.new((19.35, 25.5, 3.5))
v4 = bm.verts.new((0.0, 25.5, 3.5))
f1 = bm.faces.new((v4, v3, v2, v1)) # clockwise looking from above -> normal points DOWN

# 2. Corridor / Foyer: X=[19.35, 27.5], Y=[0.0, 21.5], Z=3.5
v5 = bm.verts.new((19.35, 0.0, 3.5))
v6 = bm.verts.new((27.5, 0.0, 3.5))
v7 = bm.verts.new((27.5, 21.5, 3.5))
v8 = bm.verts.new((19.35, 21.5, 3.5))
f2 = bm.faces.new((v8, v7, v6, v5)) # normal points DOWN

# Add UV coordinates
uv_layer = bm.loops.layers.uv.new()
# Main hall UVs
f1.loops[0][uv_layer].uv = (0.0, 0.0)
f1.loops[1][uv_layer].uv = (10.0, 0.0)
f1.loops[2][uv_layer].uv = (10.0, 12.0)
f1.loops[3][uv_layer].uv = (0.0, 12.0)
# Foyer UVs
f2.loops[0][uv_layer].uv = (0.0, 0.0)
f2.loops[1][uv_layer].uv = (4.0, 0.0)
f2.loops[2][uv_layer].uv = (4.0, 10.0)
f2.loops[3][uv_layer].uv = (0.0, 10.0)

bm.to_mesh(ceil_mesh)
bm.free()

ceil_img = get_or_create_image("ceiling_tiles.png")
ceil_norm = get_or_create_image("ceiling_normal.png")
ceil_rough = get_or_create_image("ceiling_roughness.png")
ceil_em = get_or_create_image("ceiling_emission.png")
mat_ceiling = create_pbr_material("Mat_Ceiling", base_color_img=ceil_img, normal_img=ceil_norm, roughness_img=ceil_rough, emission_img=ceil_em, emission_strength=2.2, uv_scale=(1.0, 1.0))
ceil_obj.data.materials.append(mat_ceiling)
print("Venue Ceiling mesh created and textured successfully.")

print("=== 8. Setting Up First-Person Player Rig in Blender ===")
player_col = bpy.data.collections.get("Player")
if not player_col:
    player_col = bpy.data.collections.new("Player")
    bpy.context.scene.collection.children.link(player_col)

player_root = bpy.data.objects.get("Player_Rig")
if not player_root:
    player_root = bpy.data.objects.new("Player_Rig", None)
    player_root.empty_display_type = 'ARROWS'
    player_root.empty_display_size = 0.8
    player_col.objects.link(player_root)

player_root.location = (9.68, 2.0, 0.0) # South entrance looking toward Stage at Y=23.5

player_cam_data = bpy.data.cameras.get("Player_Camera_Data")
if not player_cam_data:
    player_cam_data = bpy.data.cameras.new("Player_Camera_Data")
player_cam_data.lens = 22.0
player_cam_data.clip_start = 0.1
player_cam_data.clip_end = 200.0

player_cam_obj = bpy.data.objects.get("Player_Camera")
if not player_cam_obj:
    player_cam_obj = bpy.data.objects.new("Player_Camera", player_cam_data)
    player_col.objects.link(player_cam_obj)

player_cam_obj.parent = player_root
player_cam_obj.location = (0.0, 0.0, 1.65)
# In Blender, looking along +Y requires camera rotation (90 deg, 0, 0)
player_cam_obj.rotation_euler = (math.radians(90), 0, 0)
bpy.context.scene.camera = player_cam_obj

print("=== 9. Packing ALL Textures into the .blend file ===")
bpy.ops.file.pack_all()

print("Saving refined blend file:", BLEND_OUT)
bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT)

print("Updating original blend file with packed textures:", BLEND_IN)
bpy.ops.wm.save_as_mainfile(filepath=BLEND_IN)

print("=== 10. Exporting Production GLB ===")
bpy.ops.export_scene.gltf(
    filepath=GLB_OUT,
    export_format='GLB',
    use_selection=False,
    export_apply=True,
    export_cameras=True,
    export_lights=True,
    export_materials='EXPORT',
    export_image_format='AUTO'
)

print("ALL BLENDER TEXTURING & PACKING COMPLETED SUCCESSFULLY!")
