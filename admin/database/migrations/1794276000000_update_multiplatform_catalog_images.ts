import { BaseSchema } from '@adonisjs/lucid/schema'

const catalogImages = [
  ['nomad_excalidraw', 'excalidraw/excalidraw:sha-4bfc5bb', 'excalidraw/excalidraw:latest'],
  [
    'nomad_translate',
    'ghcr.io/crosstalk-solutions/project-nomad-translate:0.1.1',
    'ghcr.io/bigmoontech/project-nomad-wsl-translate:1.35.100',
  ],
]

export default class extends BaseSchema {
  private replaceImages(reverse: boolean) {
    this.defer(async (db) => {
      for (const [name, oldImage, newImage] of catalogImages) {
        await db.from('services')
          .where('service_name', name)
          .where('container_image', reverse ? newImage : oldImage)
          .where('is_custom', false)
          .where('is_user_modified', false)
          .where('installed', false)
          .update({ container_image: reverse ? oldImage : newImage })
      }
    })
  }

  async up() { this.replaceImages(false) }
  async down() { this.replaceImages(true) }
}
