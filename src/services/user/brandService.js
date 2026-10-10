const Brand =
  require('../../models/brands');




const getBrands = async () => {

  const brands =
    await Brand.find({

      deletedAt: null,

      isActive: true,

    })
      .select(
        'brandName slug logo'
      )
      .sort({
        brandName: 1,
      })
      .lean();


  return brands.map(
    brand => ({

      id: brand._id,

      name:
        brand.brandName,

      slug:
        brand.slug,

      logo:
        brand.logo,

    })
  );

};


module.exports = {
  getBrands,
};